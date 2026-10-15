import { useCallback, useContext } from 'react'
import { useIntl } from 'react-intl'
import { useSnackbar } from 'notistack'
import ArrowBackOutlinedIcon from '@mui/icons-material/ArrowBackOutlined'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import {
  getSelectedSpec,
  useAppStore,
  useCropStore,
  useRetouchStore,
  useSpecStore,
} from '../../stores'
import { createIDPhoto, createPrintSheet, getFileSizeExcess } from '../../utils'
import {
  CloseButton,
  ConfigContext,
  SaveButton,
  TextureBackground,
} from '../../components'
import ImagePreview from './ImagePreview'
import BottomBar from './BottomBar'

const theme = createTheme({
  palette: {
    mode: 'dark',
  },
  typography: {
    button: {
      textTransform: 'none',
    },
  },
})

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export interface ImageRetouchProps {}

export default function ImageRetouch(props: ImageRetouchProps) {
  const intl = useIntl()
  const config = useContext(ConfigContext)
  const { enqueueSnackbar } = useSnackbar()
  const handleClose = useAppStore((state) => state.cancel)
  const handleSave = useCallback(async () => {
    try {
      const spec = getSelectedSpec()
      const { image, background, adjustment } = useRetouchStore.getState()
      const idPhoto = await createIDPhoto({
        image,
        background,
        adjustment,
        resolution: spec.dimension,
      })
      if (!idPhoto) {
        return
      }
      // Warn (don't block) when the PNG exceeds the authority's file limit.
      const excess = getFileSizeExcess(idPhoto.size, spec)
      if (config.savePhoto) {
        await config.savePhoto(idPhoto)
      } else {
        downloadBlob(idPhoto, 'idphoto.png')
      }
      enqueueSnackbar(
        intl.formatMessage({ id: 'saveSucceeded', defaultMessage: 'Saved.' }),
        { variant: 'success' }
      )
      if (excess) {
        enqueueSnackbar(
          intl.formatMessage(
            {
              id: 'fileSizeExceeded',
              defaultMessage:
                'The saved photo is {actual} KB, larger than the {max} KB this photo type allows. You may need to compress it before uploading.',
            },
            { actual: excess.actualKB, max: excess.maxKB }
          ),
          { variant: 'warning' }
        )
      }
    } catch (error) {
      enqueueSnackbar(
        intl.formatMessage({
          id: 'saveFailed',
          defaultMessage: 'Save failed.',
        }),
        { variant: 'error' }
      )
    }
  }, [config, enqueueSnackbar, intl])

  const handlePrintSheet = useCallback(async () => {
    try {
      const spec = getSelectedSpec()
      const { image, background, adjustment } = useRetouchStore.getState()
      const sheet = await createPrintSheet({
        image,
        background,
        adjustment,
        dimension: spec.dimension,
      })
      if (!sheet) {
        enqueueSnackbar(
          intl.formatMessage({
            id: 'printSheetTooLarge',
            defaultMessage:
              'This photo size is too large to fit on a 4x6 inch sheet.',
          }),
          { variant: 'warning' }
        )
        return
      }
      const mm = {
        width: (spec.dimension.width / spec.dimension.dpi) * 25.4,
        height: (spec.dimension.height / spec.dimension.dpi) * 25.4,
      }
      const sizeLabel = `${Math.round(mm.width)}x${Math.round(mm.height)}mm`
      if (config.savePhoto) {
        await config.savePhoto(sheet.blob)
      } else {
        downloadBlob(
          sheet.blob,
          `idphoto-4x6-${sizeLabel}-${sheet.layout.count}up.png`
        )
      }
      enqueueSnackbar(
        intl.formatMessage(
          {
            id: 'printSheetSaved',
            defaultMessage:
              '4x6 sheet: {count} x {title} ({size}), {columns}x{rows} at {dpi} DPI.',
          },
          {
            count: sheet.layout.count,
            title: spec.title,
            size: sizeLabel,
            columns: sheet.layout.columns,
            rows: sheet.layout.rows,
            dpi: sheet.layout.dpi,
          }
        ),
        { variant: 'success' }
      )
    } catch (error) {
      enqueueSnackbar(
        intl.formatMessage({
          id: 'printSheetFailed',
          defaultMessage: 'Could not create the print sheet.',
        }),
        { variant: 'error' }
      )
    }
  }, [config, enqueueSnackbar, intl])

  return (
    <ThemeProvider theme={theme}>
      <Box className="absolute inset-0">
        <TextureBackground className="bg-white" />
        <Box className="relative z-0 flex flex-col w-full h-full">
          <AppBar className="bg-transparent" position="fixed" elevation={0}>
            <Toolbar>
              <CloseButton
                className="mr-4"
                icon={<ArrowBackOutlinedIcon />}
                onClick={handleClose}
              />
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                {intl.formatMessage({ id: 'retouch' })} (2/2)
              </Typography>
              <SaveButton
                className="mr-3"
                icon={<PrintOutlinedIcon />}
                title={intl.formatMessage({
                  id: 'printSheet',
                  defaultMessage: '4x6 inch sheet',
                })}
                onClick={handlePrintSheet}
              />
              <SaveButton onClick={handleSave} />
            </Toolbar>
          </AppBar>
          <ImagePreview />
          <BottomBar />
        </Box>
      </Box>
    </ThemeProvider>
  )
}
