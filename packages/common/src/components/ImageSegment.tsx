import { useContext, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import Tooltip from '@mui/material/Tooltip'
import { useCropStore, useSegementStore } from '../stores'
import ConfigContext from './ConfigContext'

export function ImageSegment() {
  const intl = useIntl()
  const config = useContext(ConfigContext)
  const { error, loading, progress, step, process } = useSegementStore()
  const [tooltipOpen, setTooltipOpen] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (loading) {
      // wait animation finish
      timer = setTimeout(() => {
        timer = undefined
        setTooltipOpen(true)
      }, 400)
    } else {
      setTooltipOpen(false)
    }
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [loading])
  if (loading) {
    return (
      <Tooltip
        arrow
        open={tooltipOpen}
        placement="left"
        title={
          step === 1
            ? intl.formatMessage({
                id: 'segmentDownloading',
                defaultMessage: 'Downloading the AI model…',
              })
            : intl.formatMessage({
                id: 'segmentProcessing',
                defaultMessage: 'Removing the background…',
              })
        }
      >
        <Box className="relative z-10">
          <CircularProgress
            className="block text-white"
            variant="determinate"
            color="info"
            size={30}
            value={progress}
          />
          <Box className="absolute top-1/2 left-1/2 text-white text-xs font-bold scale-75 -translate-x-1/2 -translate-y-1/2">
            {`${Math.floor(progress)}%`}
          </Box>
        </Box>
      </Tooltip>
    )
  }
  if (error) {
    const retryLabel = intl.formatMessage({
      id: 'segmentRetry',
      defaultMessage: 'Retry background removal',
    })
    return (
      <Tooltip arrow placement="left" title={retryLabel}>
        <IconButton
          className="relative z-10 text-white"
          size="small"
          aria-label={retryLabel}
          onClick={() => {
            const { image } = useCropStore.getState()
            if (image) {
              process(image, config.segment).catch(() => {
                // The cropper shows the failure notice.
              })
            }
          }}
        >
          <ReplayOutlinedIcon />
        </IconButton>
      </Tooltip>
    )
  }
  return null
}

export default ImageSegment
