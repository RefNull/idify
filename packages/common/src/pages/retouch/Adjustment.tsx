import { SyntheticEvent, useState } from 'react'
import { useIntl } from 'react-intl'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Slider from '@mui/material/Slider'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import { RangePicker } from '../../components'
import { useRetouchStore } from '../../stores'
import { isNonNeutralAdjustment } from '../../utils'
import ComplianceWarning from './ComplianceWarning'

export function Adjustment() {
  const intl = useIntl()
  const [adjustment, setAdjustment] = useRetouchStore((state) => [
    state.adjustment,
    state.setAdjustment,
  ])
  const [value, setValue] = useState('brightness')
  const handleChange = (event: SyntheticEvent, newValue: string) => {
    setValue(newValue)
  }

  return (
    <Box>
      <ComplianceWarning show={isNonNeutralAdjustment(adjustment)} />
      <Tabs
        TabIndicatorProps={{
          hidden: true,
        }}
        textColor="secondary"
        value={value}
        variant="scrollable"
        scrollButtons="auto"
        onChange={handleChange}
      >
        <Tab
          label={intl.formatMessage({
            id: 'brightness',
            defaultMessage: 'Brightness',
          })}
          value="brightness"
        />
        <Tab
          label={intl.formatMessage({
            id: 'contrast',
            defaultMessage: 'Contrast',
          })}
          value="contrast"
        />
        <Tab
          label={intl.formatMessage({
            id: 'saturation',
            defaultMessage: 'Saturation',
          })}
          value="saturation"
        />
        <Tab
          label={intl.formatMessage({ id: 'noise', defaultMessage: 'Noise' })}
          value="noise"
        />
        <Tab
          label={intl.formatMessage({ id: 'sepia', defaultMessage: 'Sepia' })}
          value="sepia"
        />
        <Tab
          label={intl.formatMessage({
            id: 'vibrance',
            defaultMessage: 'Vibrance',
          })}
          value="vibrance"
        />
      </Tabs>
      <Box className="py-[6px]">
        {value === 'brightness' ? (
          <RangePicker
            value={adjustment.brightness ?? 0}
            min={-1}
            max={1}
            precision={0.01}
            step={0.01}
            segment={5}
            format={(value) => Math.round(value * 100)}
            onChange={(brightness) => {
              setAdjustment({ brightness })
            }}
          />
        ) : null}
        {value === 'contrast' ? (
          <RangePicker
            value={adjustment.contrast ?? 0}
            min={-1}
            max={1}
            precision={0.01}
            step={0.01}
            segment={5}
            format={(value) => Math.round(value * 100)}
            onChange={(contrast) => {
              setAdjustment({ contrast })
            }}
          />
        ) : null}
        {value === 'saturation' ? (
          <RangePicker
            value={adjustment.saturation ?? 0}
            min={-1}
            max={1}
            precision={0.01}
            step={0.01}
            segment={5}
            format={(value) => Math.round(value * 100)}
            onChange={(saturation) => {
              setAdjustment({ saturation })
            }}
          />
        ) : null}
        {value === 'noise' ? (
          <RangePicker
            value={adjustment.noise ?? 0}
            min={0}
            max={1}
            precision={0.01}
            step={0.01}
            segment={5}
            format={(value) => Math.round(value * 100)}
            onChange={(noise) => {
              setAdjustment({ noise })
            }}
          />
        ) : null}
        {value === 'sepia' ? (
          <RangePicker
            value={adjustment.sepia ?? 0}
            min={0}
            max={1}
            precision={0.01}
            step={0.01}
            segment={5}
            format={(value) => Math.round(value * 100)}
            onChange={(sepia) => {
              setAdjustment({ sepia })
            }}
          />
        ) : null}
        {value === 'vibrance' ? (
          <RangePicker
            value={adjustment.vibrance ?? 0}
            min={-1}
            max={1}
            precision={0.01}
            step={0.01}
            segment={5}
            format={(value) => Math.round(value * 100)}
            onChange={(vibrance) => {
              setAdjustment({ vibrance })
            }}
          />
        ) : null}
      </Box>
    </Box>
  )
}

export default Adjustment
