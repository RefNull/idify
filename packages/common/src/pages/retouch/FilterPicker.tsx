import { useCallback } from 'react'
import { useIntl } from 'react-intl'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import { useRetouchStore } from '../../stores'
import { isNonNeutralAdjustment } from '../../utils'
import ComplianceWarning from './ComplianceWarning'

export function FilterPicker() {
  const intl = useIntl()
  const adjustment = useRetouchStore((state) => state.adjustment)
  const setAdjustment = useRetouchStore((state) => state.setAdjustment)

  const isGrayscale = adjustment.saturation === -1 && !adjustment.sepia
  const isSepia = (adjustment.sepia ?? 0) >= 0.7
  const isVivid =
    (adjustment.saturation ?? 0) > 0.1 && (adjustment.vibrance ?? 0) > 0.1
  const isClear = (adjustment.contrast ?? 0) > 0.1
  const isOriginal = !isGrayscale && !isSepia && !isVivid && !isClear

  const applyOriginal = useCallback(() => {
    setAdjustment({
      saturation: 0,
      sepia: 0,
      contrast: 0,
      brightness: 0,
      vibrance: 0,
    })
  }, [setAdjustment])

  const applyGrayscale = useCallback(() => {
    setAdjustment({
      saturation: -1,
      sepia: 0,
      vibrance: 0,
      contrast: 0,
      brightness: 0,
    })
  }, [setAdjustment])

  const applySepia = useCallback(() => {
    setAdjustment({
      saturation: 0,
      sepia: 0.8,
      vibrance: 0,
      contrast: 0,
      brightness: 0,
    })
  }, [setAdjustment])

  const applyVivid = useCallback(() => {
    setAdjustment({
      saturation: 0.25,
      vibrance: 0.3,
      sepia: 0,
      contrast: 0,
      brightness: 0,
    })
  }, [setAdjustment])

  const applyClear = useCallback(() => {
    setAdjustment({
      contrast: 0.15,
      brightness: 0.05,
      saturation: 0,
      sepia: 0,
      vibrance: 0,
    })
  }, [setAdjustment])

  return (
    <>
      <ComplianceWarning show={isNonNeutralAdjustment(adjustment)} />
      <Box className="py-[12px] px-[16px]">
        <Stack
          direction="row"
          spacing={1}
          justifyContent="center"
          flexWrap="wrap"
        >
          <Chip
            label={intl.formatMessage({
              id: 'filterOriginal',
              defaultMessage: 'Original',
            })}
            color={isOriginal ? 'primary' : 'default'}
            variant={isOriginal ? 'filled' : 'outlined'}
            clickable
            onClick={applyOriginal}
          />
          <Chip
            label={intl.formatMessage({
              id: 'filterGrayscale',
              defaultMessage: 'B&W',
            })}
            color={isGrayscale ? 'primary' : 'default'}
            variant={isGrayscale ? 'filled' : 'outlined'}
            clickable
            onClick={applyGrayscale}
          />
          <Chip
            label={intl.formatMessage({
              id: 'filterSepia',
              defaultMessage: 'Sepia',
            })}
            color={isSepia ? 'primary' : 'default'}
            variant={isSepia ? 'filled' : 'outlined'}
            clickable
            onClick={applySepia}
          />
          <Chip
            label={intl.formatMessage({
              id: 'filterVivid',
              defaultMessage: 'Vivid',
            })}
            color={isVivid ? 'primary' : 'default'}
            variant={isVivid ? 'filled' : 'outlined'}
            clickable
            onClick={applyVivid}
          />
          <Chip
            label={intl.formatMessage({
              id: 'filterClear',
              defaultMessage: 'Clear',
            })}
            color={isClear ? 'primary' : 'default'}
            variant={isClear ? 'filled' : 'outlined'}
            clickable
            onClick={applyClear}
          />
        </Stack>
      </Box>
    </>
  )
}

export default FilterPicker
