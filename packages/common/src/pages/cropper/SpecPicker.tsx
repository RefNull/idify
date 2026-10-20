import classNames from 'classnames'
import {
  KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useIntl } from 'react-intl'
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import EditOutlined from '@mui/icons-material/EditOutlined'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import SaveOutlined from '@mui/icons-material/SaveOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import Backdrop from '@mui/material/Backdrop'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Slide from '@mui/material/Slide'
import TextField from '@mui/material/TextField'
import { CUSTOM_SPEC_LIMITS, ID_PHOTO_SPECS } from '../../config'
import {
  CustomSpecForm,
  createCustomSpec,
  useSpecStore,
  validateCustomSpecForm,
} from '../../stores'
import { IDPhotoSpec } from '../../types'
import {
  SPEC_TYPE_FILTERS,
  SpecIndexEntry,
  SpecSection,
  SpecTypeFilter,
  browseSpecs,
  buildSpecIndex,
  describeSpecSize,
  findHighlight,
  groupEntries,
  searchSpecs,
} from '../../utils/specSearch'

/** Locale message id for each type filter chip. */
const FILTER_LABELS: Record<SpecTypeFilter, string> = {
  all: 'specFilterAll',
  passport: 'passport',
  visa: 'visa',
  identification: 'specFilterId',
  driving: 'driving',
  student: 'student',
  generic: 'generic',
  others: 'others',
  custom: 'custom',
}

const FILTER_DEFAULTS: Record<SpecTypeFilter, string> = {
  all: 'All',
  passport: 'Passport',
  visa: 'Visa',
  identification: 'ID',
  driving: 'Driving',
  student: 'Student',
  generic: 'Generic',
  others: 'Other',
  custom: 'Custom',
}

/** Touch devices get no autofocus, so the keyboard doesn't cover the list. */
function prefersAutoFocus() {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches
  } catch (error) {
    return false
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const range = query ? findHighlight(text, query) : null
  if (!range) {
    return <>{text}</>
  }
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="bg-transparent text-inherit font-bold underline decoration-2 underline-offset-2">
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </>
  )
}

interface SpecOption {
  id: string
  entry: SpecIndexEntry
}

interface SpecRowProps {
  option: SpecOption
  index: number
  active: boolean
  selected: boolean
  query: string
  editLabel: string
  onSelect(index: number): void
  onEdit(spec: IDPhotoSpec): void
}

const SpecRow = memo(function SpecRow({
  option,
  index,
  active,
  selected,
  query,
  editLabel,
  onSelect,
  onEdit,
}: SpecRowProps) {
  const { spec } = option.entry
  const size = describeSpecSize(spec.dimension)
  return (
    <li
      id={option.id}
      role="option"
      aria-selected={selected}
      className={classNames('spec-row', {
        'spec-row-active': active,
        'spec-row-selected': selected,
      })}
      onClick={() => onSelect(index)}
    >
      <div className="min-w-0 grow">
        <div className="spec-row-title">
          <Highlight text={spec.title} query={query} />
        </div>
        <div className="spec-row-size">
          {size.physical} · {size.pixels}
        </div>
      </div>
      {selected ? (
        <CheckRoundedIcon
          className="shrink-0"
          color="primary"
          fontSize="small"
        />
      ) : null}
      {spec.type === 'custom' ? (
        <IconButton
          className="shrink-0"
          size="small"
          aria-label={editLabel}
          onClick={(event) => {
            event.stopPropagation()
            onEdit(spec)
          }}
        >
          <EditOutlined fontSize="small" />
        </IconButton>
      ) : null}
    </li>
  )
})

function SectionHeader({
  section,
  query,
  id,
}: {
  section: SpecSection
  query: string
  id: string
}) {
  const intl = useIntl()
  let content
  if (section.kind === 'recent') {
    content = (
      <>
        <HistoryRoundedIcon fontSize="inherit" />
        <span>
          {intl.formatMessage({ id: 'specRecent', defaultMessage: 'Recent' })}
        </span>
      </>
    )
  } else if (section.kind === 'suggested') {
    content = (
      <>
        <PlaceOutlinedIcon fontSize="inherit" />
        <span>
          {intl.formatMessage({
            id: 'specSuggested',
            defaultMessage: 'Suggested for your region',
          })}
        </span>
      </>
    )
  } else if (section.key === 'custom') {
    content = (
      <span>
        {intl.formatMessage({ id: 'custom', defaultMessage: 'Custom' })}
      </span>
    )
  } else {
    content = (
      <>
        {section.flag ? <span aria-hidden="true">{section.flag}</span> : null}
        <span className="truncate">
          <Highlight text={section.title} query={query} />
        </span>
        {section.zone && section.zone !== 'WW' ? (
          <span className="ml-auto opacity-60 text-[11px] tracking-wider">
            <Highlight text={section.zone} query={query} />
          </span>
        ) : null}
      </>
    )
  }
  return (
    <li role="presentation" id={id} className="spec-header">
      {content}
    </li>
  )
}

export interface CustomSpecEditorProps {
  /** The custom spec to edit, or null to add a new one. */
  editing: IDPhotoSpec | null
  onClose(): void
}

export function CustomSpecEditor({ editing, onClose }: CustomSpecEditorProps) {
  const intl = useIntl()
  const addCustom = useSpecStore((state) => state.addCustom)
  const updateCustom = useSpecStore((state) => state.updateCustom)
  const removeCustom = useSpecStore((state) => state.removeCustom)
  const [form, setForm] = useState<CustomSpecForm>(() =>
    editing
      ? {
          name: editing.title,
          width: String(editing.dimension.width),
          height: String(editing.dimension.height),
          dpi: String(editing.dimension.dpi),
        }
      : { name: '', width: '300', height: '300', dpi: '300' }
  )
  const [error, setError] = useState<{
    field: keyof CustomSpecForm
    message: string
  } | null>(null)
  const { minSize, maxSize, minDpi, maxDpi } = CUSTOM_SPEC_LIMITS
  const errorMessages = {
    customNameRequired: intl.formatMessage({
      id: 'customNameRequired',
      defaultMessage: 'Enter a name.',
    }),
    customWidthInvalid: intl.formatMessage(
      {
        id: 'customWidthInvalid',
        defaultMessage: 'Width must be a whole number from {min} to {max} px.',
      },
      { min: minSize, max: maxSize }
    ),
    customHeightInvalid: intl.formatMessage(
      {
        id: 'customHeightInvalid',
        defaultMessage: 'Height must be a whole number from {min} to {max} px.',
      },
      { min: minSize, max: maxSize }
    ),
    customDpiInvalid: intl.formatMessage(
      {
        id: 'customDpiInvalid',
        defaultMessage: 'DPI must be from {min} to {max}.',
      },
      { min: minDpi, max: maxDpi }
    ),
  }
  const preview = validateCustomSpecForm(form)
  const physical = preview.ok
    ? describeSpecSize({ ...preview.value, unit: 'mm' }).physical
    : ''
  const field = (
    name: keyof CustomSpecForm,
    label: string,
    numeric?: { min: number; max: number; step: number }
  ) => (
    <TextField
      fullWidth
      label={label}
      name={name}
      margin="dense"
      variant="standard"
      type={numeric ? 'number' : 'text'}
      inputProps={numeric ? { ...numeric, inputMode: 'numeric' } : undefined}
      value={form[name]}
      error={error?.field === name}
      helperText={error?.field === name ? error.message : undefined}
      onChange={(event) => {
        const value = event.target.value
        setForm((prevForm) => ({ ...prevForm, [name]: value }))
        if (error?.field === name) {
          setError(null)
        }
      }}
    />
  )
  const handleSave = () => {
    const result = validateCustomSpecForm(form)
    if (!result.ok) {
      setError({ field: result.field, message: errorMessages[result.error] })
      return
    }
    if (editing) {
      updateCustom(createCustomSpec(editing.name, result.value, editing))
    } else {
      addCustom(
        createCustomSpec(useSpecStore.getState().getNextName(), result.value)
      )
    }
    onClose()
  }
  return (
    <Backdrop
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 2 }}
      open
      onClick={onClose}
    >
      <Slide direction="up" in>
        <Box className="absolute z-10 bottom-0 left-0 w-full">
          <Card
            className="w-full rounded-t-3xl sm:mx-auto sm:w-[400px]"
            variant="outlined"
            role="dialog"
            aria-label={intl.formatMessage({
              id: editing ? 'editCustomSpec' : 'addCustomSpec',
              defaultMessage: editing ? 'Edit custom size' : 'Add custom size',
            })}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                onClose()
              } else if (
                event.key === 'Enter' &&
                (event.target as HTMLElement).tagName === 'INPUT'
              ) {
                handleSave()
              }
            }}
          >
            <CardHeader
              sx={{ paddingBottom: 0 }}
              subheader={intl.formatMessage({
                id: editing ? 'editCustomSpec' : 'addCustomSpec',
                defaultMessage: editing
                  ? 'Edit custom size'
                  : 'Add custom size',
              })}
              action={
                <IconButton
                  aria-label={intl.formatMessage({
                    id: 'close',
                    defaultMessage: 'Close',
                  })}
                  onClick={onClose}
                >
                  <CloseOutlined />
                </IconButton>
              }
            />
            <CardContent sx={{ paddingTop: 0 }}>
              {field(
                'name',
                intl.formatMessage({ id: 'customName', defaultMessage: 'Name' })
              )}
              {field(
                'width',
                intl.formatMessage({
                  id: 'customWidth',
                  defaultMessage: 'Width (px)',
                }),
                { min: minSize, max: maxSize, step: 1 }
              )}
              {field(
                'height',
                intl.formatMessage({
                  id: 'customHeight',
                  defaultMessage: 'Height (px)',
                }),
                { min: minSize, max: maxSize, step: 1 }
              )}
              {field(
                'dpi',
                intl.formatMessage({ id: 'customDpi', defaultMessage: 'DPI' }),
                { min: minDpi, max: maxDpi, step: 1 }
              )}
              {physical ? (
                <Box className="mt-2 text-xs opacity-70" aria-live="polite">
                  {intl.formatMessage(
                    {
                      id: 'customPrintSize',
                      defaultMessage: 'Prints at {size}',
                    },
                    { size: physical }
                  )}
                </Box>
              ) : null}
              <Button
                sx={{ marginTop: '20px', borderRadius: '20px' }}
                disableElevation
                fullWidth
                size="large"
                startIcon={<SaveOutlined />}
                variant="contained"
                onClick={handleSave}
              >
                {intl.formatMessage({ id: 'save' })}
              </Button>
              {editing ? (
                <Button
                  sx={{ marginTop: '10px', borderRadius: '20px' }}
                  color="error"
                  disableElevation
                  fullWidth
                  size="large"
                  startIcon={<DeleteOutline />}
                  variant="contained"
                  onClick={() => {
                    removeCustom(editing)
                    onClose()
                  }}
                >
                  {intl.formatMessage({ id: 'delete' })}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </Box>
      </Slide>
    </Backdrop>
  )
}

export interface SpecPickerProps {
  value: IDPhotoSpec
  onClose?(): void
}

export function SpecPicker({ value, onClose }: SpecPickerProps) {
  const intl = useIntl()
  const uid = useId().replace(/:/g, '')
  const listboxId = `spec-listbox-${uid}`
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const customs = useSpecStore((state) => state.customs)
  const recent = useSpecStore((state) => state.recent)
  const localeSpecs = useSpecStore((state) => state.localeSpecs)
  const setSpec = useSpecStore((state) => state.setSpec)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SpecTypeFilter>(
    value.type === 'custom' ? 'custom' : 'all'
  )
  const [editor, setEditor] = useState<{ editing: IDPhotoSpec | null } | null>(
    null
  )

  // Normalised once per spec list and locale; searching is a plain filter.
  const index = useMemo(
    () => buildSpecIndex([...ID_PHOTO_SPECS, ...customs], intl.locale),
    [customs, intl.locale]
  )
  const suggested = useMemo(
    () => localeSpecs.map((spec) => spec.name),
    [localeSpecs]
  )
  const trimmedQuery = query.trim()
  const sections = useMemo(
    () =>
      trimmedQuery
        ? groupEntries(
            searchSpecs(index, trimmedQuery, filter).map((match) => match.entry)
          )
        : browseSpecs(index, filter, {
            recent,
            suggested,
            locale: intl.locale,
          }),
    [index, trimmedQuery, filter, recent, suggested, intl.locale]
  )
  const options = useMemo(() => {
    const list: SpecOption[] = []
    for (const section of sections) {
      for (const entry of section.entries) {
        list.push({ id: `${listboxId}-${list.length}`, entry })
      }
    }
    return list
  }, [sections, listboxId])

  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.entry.spec.name === value.name)
    )
  )
  const scrollMode = useRef<'center' | 'nearest' | null>('center')

  // A new query or filter starts again from the best match.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setActive(0)
    listRef.current?.scrollTo({ top: 0 })
  }, [trimmedQuery, filter])

  useEffect(() => {
    if (active >= options.length && options.length) {
      setActive(options.length - 1)
    }
  }, [active, options.length])

  useEffect(() => {
    const mode = scrollMode.current
    if (!mode) {
      return
    }
    scrollMode.current = null
    const option = options[active]
    if (option) {
      document.getElementById(option.id)?.scrollIntoView({ block: mode })
    }
  }, [active, options])

  useEffect(() => {
    if (!prefersAutoFocus()) {
      return
    }
    const timer = setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  const handleSelect = useCallback(
    (optionIndex: number) => {
      const option = options[optionIndex]
      if (option) {
        setSpec(option.entry.spec.name)
        onClose?.()
      }
    },
    [options, setSpec, onClose]
  )
  const handleEdit = useCallback((spec: IDPhotoSpec) => {
    setEditor({ editing: spec })
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = (delta: number) => {
      event.preventDefault()
      if (!options.length) {
        return
      }
      scrollMode.current = 'nearest'
      setActive((current) =>
        Math.min(options.length - 1, Math.max(0, current + delta))
      )
    }
    switch (event.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'PageDown':
        move(8)
        break
      case 'PageUp':
        move(-8)
        break
      case 'Enter':
        event.preventDefault()
        handleSelect(active)
        break
    }
  }

  const editLabel = intl.formatMessage({
    id: 'editCustomSpec',
    defaultMessage: 'Edit custom size',
  })
  const addButton = (
    <Button
      variant="text"
      startIcon={<AddCircleOutlineRoundedIcon />}
      onClick={() => setEditor({ editing: null })}
    >
      {intl.formatMessage({
        id: 'addCustomSpec',
        defaultMessage: 'Add custom size',
      })}
    </Button>
  )

  let optionIndex = 0
  const activeOption = options[active]

  return (
    <Backdrop
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      open
      onClick={onClose}
    >
      <Slide direction="up" in>
        <Box className="absolute z-10 bottom-0 left-0 w-full">
          <Card
            className="w-full rounded-t-3xl sm:mx-auto sm:w-[400px]"
            variant="outlined"
            onClick={(event) => {
              event.stopPropagation()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                onClose?.()
              } else if (
                event.key.length === 1 &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !editor &&
                (event.target as HTMLElement).tagName !== 'INPUT'
              ) {
                // Type-to-search from a chip or the list.
                inputRef.current?.focus()
              }
            }}
          >
            <Box className="flex items-center gap-1 pl-3 pr-2 pt-3">
              <Box
                className="flex items-center gap-2 grow min-w-0 pl-3 pr-1 rounded-full"
                sx={{
                  bgcolor: 'action.hover',
                  border: 1,
                  borderColor: 'divider',
                  '&:focus-within': { borderColor: 'primary.main' },
                }}
                onClick={() => inputRef.current?.focus()}
              >
                <SearchRoundedIcon className="opacity-70" fontSize="small" />
                <InputBase
                  className="grow"
                  sx={{
                    height: 40,
                    '& input::-webkit-search-cancel-button': {
                      display: 'none',
                    },
                  }}
                  inputRef={inputRef}
                  placeholder={intl.formatMessage({
                    id: 'specSearchPlaceholder',
                    defaultMessage: 'Search country, code or title',
                  })}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={handleKeyDown}
                  inputProps={{
                    role: 'combobox',
                    type: 'search',
                    enterKeyHint: 'go',
                    autoComplete: 'off',
                    autoCorrect: 'off',
                    autoCapitalize: 'off',
                    spellCheck: false,
                    'aria-label': intl.formatMessage({
                      id: 'specSearchLabel',
                      defaultMessage: 'Search photo sizes',
                    }),
                    'aria-expanded': true,
                    'aria-autocomplete': 'list',
                    'aria-controls': listboxId,
                    'aria-activedescendant': activeOption?.id,
                  }}
                />
                {query ? (
                  <IconButton
                    size="small"
                    aria-label={intl.formatMessage({
                      id: 'clearSearch',
                      defaultMessage: 'Clear search',
                    })}
                    onClick={() => {
                      setQuery('')
                      inputRef.current?.focus()
                    }}
                  >
                    <CloseOutlined fontSize="small" />
                  </IconButton>
                ) : null}
              </Box>
              <IconButton
                size="small"
                aria-label={intl.formatMessage({
                  id: 'close',
                  defaultMessage: 'Close',
                })}
                onClick={onClose}
              >
                <ExpandMoreRoundedIcon />
              </IconButton>
            </Box>
            <Box
              className="flex gap-2 overflow-x-auto px-4 py-2"
              role="group"
              aria-label={intl.formatMessage({
                id: 'specFilterLabel',
                defaultMessage: 'Photo type',
              })}
              sx={{
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              {SPEC_TYPE_FILTERS.map((item) => (
                <Chip
                  key={item}
                  size="small"
                  label={intl.formatMessage({
                    id: FILTER_LABELS[item],
                    defaultMessage: FILTER_DEFAULTS[item],
                  })}
                  color={filter === item ? 'primary' : 'default'}
                  variant={filter === item ? 'filled' : 'outlined'}
                  aria-pressed={filter === item}
                  clickable
                  onClick={() => setFilter(item)}
                />
              ))}
            </Box>
            <div className="sr-only" aria-live="polite">
              {trimmedQuery
                ? intl.formatMessage(
                    {
                      id: 'specResultsCount',
                      defaultMessage:
                        '{count, plural, =0 {No matches} one {# match} other {# matches}}',
                    },
                    { count: options.length }
                  )
                : ''}
            </div>
            <Box
              className="h-[400px] max-h-[55vh] overflow-y-auto overscroll-contain"
              ref={listRef}
              component="ul"
              id={listboxId}
              role="listbox"
              aria-label={intl.formatMessage({
                id: 'size',
                defaultMessage: 'Size',
              })}
              sx={{
                margin: 0,
                padding: '0 0 8px',
                listStyle: 'none',
                '&::-webkit-scrollbar': { width: '6px' },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: '#666',
                  borderRadius: '8px',
                },
                '& .spec-header': {
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 16px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'text.secondary',
                  bgcolor: 'background.paper',
                },
                '& .spec-row': {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  minHeight: '48px',
                  padding: '4px 12px 4px 16px',
                  cursor: 'pointer',
                  scrollMarginTop: '32px',
                },
                '& .spec-row:hover': { bgcolor: 'action.hover' },
                '& .spec-row-active': { bgcolor: 'action.selected' },
                '& .spec-row-active:hover': { bgcolor: 'action.selected' },
                '& .spec-row-title': {
                  fontSize: '14px',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
                '& .spec-row-selected .spec-row-title': {
                  color: 'primary.main',
                },
                '& .spec-row-size': {
                  fontSize: '12px',
                  color: 'text.secondary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
                '& .spec-group': {
                  contentVisibility: 'auto',
                  containIntrinsicSize: 'auto 200px',
                },
              }}
            >
              {filter === 'custom' && !trimmedQuery && options.length ? (
                <li role="presentation" className="text-center py-1">
                  {addButton}
                </li>
              ) : null}
              {sections.map((section) => {
                const headerId = `${listboxId}-h-${section.key}`
                return (
                  <li
                    role="presentation"
                    key={section.key}
                    className="spec-group"
                  >
                    <ul
                      role="group"
                      aria-labelledby={headerId}
                      className="m-0 p-0 list-none"
                    >
                      <SectionHeader
                        id={headerId}
                        section={section}
                        query={trimmedQuery}
                      />
                      {section.entries.map((entry) => {
                        const index = optionIndex++
                        const option = options[index]
                        return (
                          <SpecRow
                            key={option.id}
                            option={option}
                            index={index}
                            active={index === active}
                            selected={entry.spec.name === value.name}
                            query={trimmedQuery}
                            editLabel={editLabel}
                            onSelect={handleSelect}
                            onEdit={handleEdit}
                          />
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
              {!options.length ? (
                <li
                  role="presentation"
                  className="flex flex-col items-center justify-center gap-2 h-full px-6 text-center"
                >
                  {filter === 'custom' && !trimmedQuery ? (
                    <Box className="text-sm opacity-70">
                      {intl.formatMessage({
                        id: 'specNoCustom',
                        defaultMessage: 'No custom sizes yet.',
                      })}
                    </Box>
                  ) : (
                    <>
                      <Box className="text-base">
                        {intl.formatMessage(
                          {
                            id: 'specNoMatches',
                            defaultMessage: 'No matches for “{query}”',
                          },
                          { query: trimmedQuery }
                        )}
                      </Box>
                      <Box className="text-sm opacity-70">
                        {intl.formatMessage({
                          id: 'specNoMatchesHint',
                          defaultMessage:
                            'Try a country name, a two-letter code such as US, or another type.',
                        })}
                      </Box>
                      {filter !== 'all' ? (
                        <Button variant="text" onClick={() => setFilter('all')}>
                          {intl.formatMessage({
                            id: 'specShowAllTypes',
                            defaultMessage: 'Search all types',
                          })}
                        </Button>
                      ) : null}
                    </>
                  )}
                  {filter === 'custom' ? addButton : null}
                </li>
              ) : null}
            </Box>
            {editor ? (
              <CustomSpecEditor
                editing={editor.editing}
                onClose={() => setEditor(null)}
              />
            ) : null}
          </Card>
        </Box>
      </Slide>
    </Backdrop>
  )
}

export default SpecPicker
