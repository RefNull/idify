import { useIntl } from 'react-intl'
import Alert from '@mui/material/Alert'
import { useSelectedSpec } from '../../stores'
import { isStrictSpec } from '../../utils'

export interface ComplianceWarningProps {
  /** Whether the current edit is one authorities tend to reject. */
  show: boolean
}

/** Warns (without blocking) when a passport/visa photo gets a filter or gradient. */
export function ComplianceWarning({ show }: ComplianceWarningProps) {
  const intl = useIntl()
  const [spec] = useSelectedSpec()
  if (!show || !isStrictSpec(spec)) {
    return null
  }
  return (
    <Alert
      className="mx-[16px] mt-[8px] py-0"
      severity="warning"
      variant="outlined"
      role="status"
    >
      {intl.formatMessage({
        id: 'complianceWarning',
        defaultMessage:
          'Most passport/visa authorities reject filtered or gradient-background photos.',
      })}
    </Alert>
  )
}

export default ComplianceWarning
