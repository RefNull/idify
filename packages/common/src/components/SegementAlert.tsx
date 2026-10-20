import { forwardRef, useCallback, useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Fade from '@mui/material/Fade'
import { useIntl } from 'react-intl'
import { TransitionProps } from '@mui/material/transitions'

const ALERTED_CACHE = 'idify.sgement.alert'

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement<any, any>
  },
  ref: React.Ref<unknown>
) {
  return <Fade ref={ref} {...props} />
})

export function SegementAlert() {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (
      localStorage.getItem(ALERTED_CACHE) !== '1' &&
      sessionStorage.getItem(ALERTED_CACHE) !== '1'
    ) {
      sessionStorage.setItem(ALERTED_CACHE, '1')
      timer = setTimeout(() => {
        timer = undefined
        setOpen(true)
      }, 500)
    }
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])
  const handleClose = useCallback(() => {
    setOpen(false)
  }, [])
  return (
    <Dialog open={open} TransitionComponent={Transition} onClose={handleClose}>
      <DialogTitle>
        {intl.formatMessage({
          id: 'segmentAlertTitle',
          defaultMessage: 'Removing the photo background',
        })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {intl.formatMessage({
            id: 'segmentAlertText',
            defaultMessage:
              'Idify removes the background on your device while you work. Progress is shown in the top-right corner, and it may take a little while. Meanwhile you can choose the photo size and crop the photo; you can continue to the next step once it has finished.',
          })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            handleClose()
            localStorage.setItem(ALERTED_CACHE, '1')
          }}
        >
          {intl.formatMessage({
            id: 'dontShowAgain',
            defaultMessage: "Don't show again",
          })}
        </Button>
        <Button onClick={handleClose} autoFocus>
          {intl.formatMessage({ id: 'ok', defaultMessage: 'OK' })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default SegementAlert
