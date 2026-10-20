import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useMeasure } from 'react-use'
import EaseCropper, {
  Area,
  MediaSize,
  getInitialCropFromCroppedAreaPixels,
} from 'react-easy-crop'
import Box from '@mui/material/Box'
import { CROPPER_ZOOM_MAX, CROPPER_ZOOM_MIN } from '../../config'
import { useAdaptedSize } from '../../hooks'
import {
  useCropStore,
  useRetouchStore,
  useSegementStore,
  useSelectedSpec,
} from '../../stores'
import { ConfigContext } from '../../components'
import {
  DetectedFace,
  MaskData,
  createHeadGuideSVG,
  detectFace,
  getAutoCropArea,
  getHeadBox,
  loadMask,
} from '../../utils'

export function LiveCropper() {
  const [measureRef, measureRect] = useMeasure<HTMLDivElement>()
  const [spec] = useSelectedSpec()
  const image = useCropStore((state) => state.image)
  const useOriginalBackground = useCropStore(
    (state) => state.useOriginalBackground
  )
  const segmentedImage = useSegementStore((state) => state.result)
  const limit = useMemo(
    () => ({
      width: Math.max(measureRect.width - 100, 100),
      height: Math.max(measureRect.height - 100, 100),
    }),
    [measureRect]
  )
  const cropSize = useAdaptedSize(spec, limit)
  const {
    position,
    setPosition,
    rotation,
    setRotation,
    zoom,
    setZoom,
    setArea: setCroppedArea,
    flipHorizontal,
    flipVertical,
  } = useCropStore()
  const onCropComplete = useCallback(
    (_: Area, croppedAreaPixels: Area) => {
      setCroppedArea(croppedAreaPixels)
    },
    [setCroppedArea]
  )
  // Frame the head automatically: as soon as the face is found, and again
  // when the background-removal mask refines the crown or the spec changes,
  // until the user adjusts the crop by hand.
  const config = useContext(ConfigContext)
  const publicPath = config.segment?.publicPath
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null)
  const [face, setFace] = useState<{ url: string; box: DetectedFace } | null>(
    null
  )
  const [mask, setMask] = useState<{ url: string; data: MaskData } | null>(null)
  useEffect(() => {
    if (!image) {
      return
    }
    let cancelled = false
    detectFace(image, publicPath)
      .then((box) => {
        if (!cancelled && box) {
          setFace({ url: image, box })
        }
      })
      .catch(() => {
        // No framing; the crop simply stays where it is.
      })
    return () => {
      cancelled = true
    }
  }, [image, publicPath])
  useEffect(() => {
    if (!segmentedImage) {
      return
    }
    let cancelled = false
    loadMask(segmentedImage)
      .then((data) => {
        if (!cancelled && data) {
          setMask({ url: segmentedImage, data })
        }
      })
      .catch(() => {
        // Keep the crown estimated from the face.
      })
    return () => {
      cancelled = true
    }
  }, [segmentedImage])
  useEffect(() => {
    if (!face || face.url !== image || !mediaSize) {
      return
    }
    const { touched, rotation } = useCropStore.getState()
    if (touched) {
      return
    }
    // Only a mask of this same photo can refine the crown.
    const segment = useSegementStore.getState()
    const ownMask =
      mask && segment.image === image && mask.url === segment.result
        ? mask.data
        : null
    const area = getAutoCropArea(getHeadBox(face.box, ownMask), spec, {
      width: mediaSize.naturalWidth,
      height: mediaSize.naturalHeight,
    })
    const { crop, zoom } = getInitialCropFromCroppedAreaPixels(
      area,
      mediaSize,
      rotation,
      cropSize,
      CROPPER_ZOOM_MIN,
      CROPPER_ZOOM_MAX
    )
    useCropStore.getState().autoFrame(crop, zoom)
  }, [face, mask, image, mediaSize, spec, cropSize])
  const touch = useCropStore((state) => state.touch)

  const guides = useRetouchStore((state) => state.guides)
  const maskImage = useMemo(
    () => (guides ? createHeadGuideSVG(spec, cropSize) : ''),
    [guides, spec, cropSize]
  )
  const displayImage =
    spec?.prohibitBackgroundRemoval || useOriginalBackground
      ? image
      : segmentedImage || image

  return (
    <Box
      ref={measureRef}
      className="relative flex flex-col justify-center items-center grow pt-[56px]"
      sx={{
        '& .reactEasyCrop_Container': {
          overflow: 'visible',
        },
        '& .reactEasyCrop_CropArea': {
          color: 'rgba(0, 0, 0, 0.6)',
        },
      }}
    >
      <EaseCropper
        style={{
          cropAreaStyle: {
            backgroundImage: maskImage ? `url('${maskImage}')` : undefined,
            backgroundSize: '100% 100%',
          },
        }}
        image={displayImage}
        aspect={spec.dimension.width / spec.dimension.height}
        crop={position}
        cropSize={cropSize}
        rotation={rotation}
        zoom={zoom}
        minZoom={CROPPER_ZOOM_MIN}
        maxZoom={CROPPER_ZOOM_MAX}
        restrictPosition={false}
        showGrid={false}
        transform={[
          `translate(${position.x}px, ${position.y}px)`,
          `rotateZ(${rotation}deg)`,
          `rotateY(${flipHorizontal ? 180 : 0}deg)`,
          `rotateX(${flipVertical ? 180 : 0}deg)`,
          `scale(${zoom})`,
        ].join(' ')}
        onCropChange={setPosition}
        onCropComplete={onCropComplete}
        onMediaLoaded={setMediaSize}
        onInteractionStart={touch}
        onRotationChange={setRotation}
        onZoomChange={setZoom}
      />
    </Box>
  )
}

export default LiveCropper
