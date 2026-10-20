import classNames from 'classnames'
import { useCallback, useContext } from 'react'
import { useIntl } from 'react-intl'
import { useSnackbar } from 'notistack'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import Avatar from '@mui/material/Avatar'
import AvatarGroup from '@mui/material/AvatarGroup'
import Box from '@mui/material/Box'
import { useAppStore, useSegementStore } from '../stores'
import ConfigContext from './ConfigContext'
import demo1 from '../assets/demos/demo-1.jpg'
import demo2 from '../assets/demos/demo-2.jpg'
import demo3 from '../assets/demos/demo-3.jpg'

/** Bundled sample photos (Unsplash License, see assets/demos/README.md). */
const DEMOS = [demo1, demo2, demo3]

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 30 * 1024 * 1024

/**
 * Object URL of the last file picked here. Kept at module level because this
 * component unmounts once the cropper opens; revoked when a new file replaces it.
 */
let lastObjectUrl: string | null = null

export function ImageAdd() {
  const config = useContext(ConfigContext)
  const intl = useIntl()
  const { enqueueSnackbar } = useSnackbar()
  const crop = useAppStore((state) => state.crop)
  const { process: segment } = useSegementStore()
  const handleAdd = useCallback(
    (file: string) => {
      // An empty result means the native picker was cancelled.
      if (!file) return
      // Always segment: specs that forbid background removal keep the
      // original photo, but the person mask still measures the head for
      // auto-framing.
      segment(file, config.segment).catch(() => {
        // Failures are reported by the cropper's banner (with retry);
        // superseded runs reject too and need no notice.
      })
      crop(file)
    },
    [crop, segment, config]
  )

  return (
    <Box className="relative">
      <AddPhotoAlternateIcon className="block text-8xl text-white" />
      <input
        className="absolute z-1 inset-0 opacity-0 cursor-pointer"
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onClick={(event) => {
          if (config.getPhoto) {
            event.preventDefault()
            config
              .getPhoto()
              .then(handleAdd)
              .catch(() => {
                // Picker cancelled or unavailable; nothing to do.
              })
          }
        }}
        onChange={(event) => {
          const input = event.target
          const file = input?.files?.[0]
          // Allow picking the same file again after a rejection.
          if (input) input.value = ''
          if (!file) return
          if (!ACCEPTED_TYPES.includes(file.type)) {
            enqueueSnackbar(
              intl.formatMessage({
                id: 'imageUnsupportedType',
                defaultMessage: 'Please choose a JPEG, PNG or WebP image.',
              }),
              { variant: 'error' }
            )
            return
          }
          if (file.size > MAX_FILE_SIZE) {
            enqueueSnackbar(
              intl.formatMessage(
                {
                  id: 'imageTooLarge',
                  defaultMessage: 'The image is too large (maximum {size} MB).',
                },
                { size: MAX_FILE_SIZE / 1024 / 1024 }
              ),
              { variant: 'error' }
            )
            return
          }
          const url = URL.createObjectURL(file)
          if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl)
          lastObjectUrl = url
          handleAdd(url)
        }}
      />
      <AvatarGroup
        className={classNames(
          'absolute -bottom-[10px] left-1/2 -translate-x-1/2 translate-y-full'
        )}
      >
        {DEMOS.map((item, index) => {
          return (
            <Avatar
              key={index}
              className="cursor-pointer"
              sx={{ width: 28, height: 28 }}
              src={item}
              onClick={() => {
                handleAdd(item)
              }}
            />
          )
        })}
      </AvatarGroup>
    </Box>
  )
}

export default ImageAdd
