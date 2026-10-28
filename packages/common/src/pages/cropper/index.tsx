import { useCallback, useContext, useEffect, useState } from 'react'
import { useSnackbar } from 'notistack'
import { useIntl } from 'react-intl'
import DoneAllOutlinedIcon from '@mui/icons-material/DoneAllOutlined'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import {
  getSelectedSpec,
  useAppStore,
  useCropStore,
  useSegementStore,
  useSelectedSpec,
} from '../../stores'
import { cropIDPhoto } from '../../utils'
import {
  CloseButton,
  ConfigContext,
  ImageSegment,
  SaveButton,
  SegementAlert,
  TextureBackground,
} from '../../components'
import BottomBar from './BottomBar'
import LiveCropper from './LiveCropper'

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

type PendingSave = null | 'ask' | 'waiting'

export default function Cropper() {
  const intl = useIntl()
  const config = useContext(ConfigContext)
  const [spec] = useSelectedSpec()
  const image = useCropStore((state) => state.image)
  const segmentedImage = useSegementStore((state) => state.result)
  const segmentLoading = useSegementStore((state) => state.loading)
  const segmentProgress = useSegementStore((state) => state.progress)
  const segmentError = useSegementStore((state) => state.error)
  const isOriginalOnly = Boolean(spec?.prohibitBackgroundRemoval)
  const useOriginalBackground = useCropStore(
    (state) => state.useOriginalBackground
  )
  const setUseOriginalBackground = useCropStore(
    (state) => state.setUseOriginalBackground
  )
  const { enqueueSnackbar } = useSnackbar()
  const [pendingSave, setPendingSave] = useState<PendingSave>(null)
  const [errorDismissed, setErrorDismissed] = useState(false)

  useEffect(() => {
    setErrorDismissed(false)
  }, [segmentError])

  // Background removal starts at upload; if nothing has run for this image
  // yet, start it now. Specs that forbid removal still use the mask to
  // measure the head, but keep the original photo.
  useEffect(() => {
    if (!image) {
      return
    }
    const segment = useSegementStore.getState()
    if (
      segment.image === image &&
      (segment.loading || segment.result || segment.error)
    ) {
      return
    }
    segment.process(image, config.segment).catch(() => {
      // Shown by the error notice below, with a retry button.
    })
  }, [image, config.segment])

  const save = useCallback(
    async (forceOriginal = false) => {
      try {
        const currentSpec = getSelectedSpec()
        const {
          image,
          rotation,
          flipHorizontal,
          flipVertical,
          area: croppedArea,
        } = useCropStore.getState()
        const { result } = useSegementStore.getState()
        const useOriginal =
          forceOriginal ||
          currentSpec?.prohibitBackgroundRemoval ||
          useCropStore.getState().useOriginalBackground ||
          !result
        const sourceImage = useOriginal ? image : result

        const cropOptions = {
          area: croppedArea,
          rotation,
          flipHorizontal,
          flipVertical,
          resolution: currentSpec.dimension,
        }
        const idPhoto = await cropIDPhoto({
          ...cropOptions,
          image: sourceImage,
        })
        // The same crop of the original lets retouching blend some of the
        // original background back in.
        const original = useOriginal
          ? undefined
          : await cropIDPhoto({ ...cropOptions, image })
        useAppStore.getState().retouch(idPhoto, original)
      } catch (error) {
        enqueueSnackbar(
          intl.formatMessage({
            id: 'saveFailed',
            defaultMessage: 'Save failed.',
          }),
          {
            variant: 'error',
          }
        )
      }
    },
    [enqueueSnackbar, intl]
  )

  const handleSave = useCallback(() => {
    const currentSpec = getSelectedSpec()
    const { useOriginalBackground } = useCropStore.getState()
    const { loading } = useSegementStore.getState()
    if (
      loading &&
      !currentSpec?.prohibitBackgroundRemoval &&
      !useOriginalBackground
    ) {
      // Saving now would silently keep the original background: ask first.
      setPendingSave('ask')
      return
    }
    save()
  }, [save])

  // Waiting for background removal: continue once it settles.
  useEffect(() => {
    if (pendingSave !== 'waiting' || segmentLoading) {
      return
    }
    setPendingSave(null)
    if (segmentedImage) {
      save()
    } else if (segmentError) {
      enqueueSnackbar(
        intl.formatMessage({
          id: 'segmentFailedNotice',
          defaultMessage:
            'Background removal failed. Retry, or continue with the original background.',
        }),
        { variant: 'error' }
      )
    }
  }, [
    pendingSave,
    segmentLoading,
    segmentedImage,
    segmentError,
    save,
    enqueueSnackbar,
    intl,
  ])

  const handleUseOriginal = useCallback(() => {
    setPendingSave(null)
    setUseOriginalBackground(true)
    save(true)
  }, [save, setUseOriginalBackground])

  const handleClose = useCallback(() => {
    useSegementStore.getState().reset()
    useAppStore.getState().reset()
  }, [])

  return (
    <ThemeProvider theme={theme}>
      <Box className="absolute inset-0">
        {segmentedImage && !isOriginalOnly && !useOriginalBackground ? (
          <TextureBackground className="bg-white" />
        ) : null}
        <Box className="relative z-0 flex flex-col w-full h-full">
          <AppBar className="bg-transparent" position="fixed" elevation={0}>
            <Toolbar>
              <CloseButton className="mr-4" onClick={handleClose} />
              <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                {intl.formatMessage({ id: 'crop' })} (1/2)
              </Typography>
              <Box className="flex items-center space-x-2">
                {!isOriginalOnly ? <ImageSegment /> : null}
                {segmentedImage && !isOriginalOnly ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color={useOriginalBackground ? 'inherit' : 'primary'}
                    sx={{
                      mr: 1,
                      textTransform: 'none',
                      fontSize: '0.75rem',
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    }}
                    onClick={() =>
                      setUseOriginalBackground(!useOriginalBackground)
                    }
                  >
                    {useOriginalBackground
                      ? intl.formatMessage({
                          id: 'originalBackground',
                          defaultMessage: 'Original Bg',
                        })
                      : intl.formatMessage({
                          id: 'cutoutBackground',
                          defaultMessage: 'Cutout Bg',
                        })}
                  </Button>
                ) : null}
                <SaveButton
                  icon={<DoneAllOutlinedIcon />}
                  onClick={handleSave}
                />
              </Box>
            </Toolbar>
          </AppBar>
          {segmentError && !isOriginalOnly && !errorDismissed ? (
            <Alert
              className="absolute z-10 left-1/2 -translate-x-1/2 top-[64px] w-[calc(100%-32px)] sm:w-[400px]"
              severity="warning"
              variant="filled"
              onClose={() => setErrorDismissed(true)}
            >
              {intl.formatMessage({
                id: 'segmentFailedNotice',
                defaultMessage:
                  'Background removal failed. Retry, or continue with the original background.',
              })}
            </Alert>
          ) : null}
          <LiveCropper />
          <BottomBar />
        </Box>
        {!isOriginalOnly ? <SegementAlert /> : null}
        <Dialog
          open={pendingSave !== null}
          onClose={() => setPendingSave(null)}
        >
          <DialogTitle>
            {intl.formatMessage({
              id: 'segmentPendingTitle',
              defaultMessage: 'Background removal is still running',
            })}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {pendingSave === 'waiting'
                ? intl.formatMessage({
                    id: 'segmentPendingWaiting',
                    defaultMessage:
                      'The photo will open for retouching as soon as the background is removed.',
                  })
                : intl.formatMessage({
                    id: 'segmentPendingText',
                    defaultMessage:
                      'Wait for it to finish, or continue now with the original background?',
                  })}
            </DialogContentText>
            {pendingSave === 'waiting' ? (
              <LinearProgress
                className="mt-4"
                variant="determinate"
                value={segmentProgress}
              />
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleUseOriginal}>
              {intl.formatMessage({
                id: 'segmentUseOriginal',
                defaultMessage: 'Use original background',
              })}
            </Button>
            {pendingSave === 'waiting' ? (
              <Button onClick={() => setPendingSave(null)}>
                {intl.formatMessage({
                  id: 'cancel',
                  defaultMessage: 'Cancel',
                })}
              </Button>
            ) : (
              <Button autoFocus onClick={() => setPendingSave('waiting')}>
                {intl.formatMessage({
                  id: 'segmentWait',
                  defaultMessage: 'Wait',
                })}
              </Button>
            )}
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  )
}
