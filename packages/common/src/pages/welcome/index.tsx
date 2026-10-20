import { useContext, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Link from '@mui/material/Link'
import { useAppStore, useSegementStore } from '../../stores'
import {
  BlobAnimation,
  ConfigContext,
  GithubLink,
  ImageCloud,
  LayoutBox,
  TextureBackground,
  WaveSea,
} from '../../components'

export default function Welcome() {
  const config = useContext(ConfigContext)
  const cloudRef = useRef<HTMLDivElement>(null)
  const step = useAppStore((state) => state.step)
  const daemon = step === 1
  const hidden = step >= 1
  if (hidden) {
    return null
  }
  return (
    <Box
      className="absolute inset-0 flex flex-col overflow-hidden"
      sx={{
        '--blob-color': '#7dd3fc',
        '--center-blob-opacity': '0.3',
      }}
    >
      <TextureBackground />
      <BlobAnimation target={cloudRef} />
      <Box className="h-16 min-h-[50px] grow" />
      <Typography
        className="relative z-0 text-4xl text-sky-900"
        sx={{
          fontFamily: 'Pacifico, cursive',
          visibility: daemon ? 'hidden' : 'visible',
        }}
        variant="h1"
        align="center"
      >
        IDIFY
      </Typography>
      <Typography
        className="relative z-0 text-xs text-sky-800/80 font-medium tracking-wide mt-1"
        sx={{
          visibility: daemon ? 'hidden' : 'visible',
        }}
        variant="body2"
        align="center"
      >
        Local &middot; 500+ Specs &middot; 4x6" Sheets &middot; Biometric Guides
      </Typography>
      <Box
        className="relative z-0 flex justify-center mt-1.5"
        sx={{
          visibility: daemon ? 'hidden' : 'visible',
        }}
      >
        <Link
          href="https://github.com/RefNull/idify"
          target="_blank"
          rel="noopener noreferrer"
          underline="none"
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide bg-sky-100/90 text-sky-800 border border-sky-300 hover:bg-sky-200 hover:text-sky-900 transition-colors shadow-sm"
        >
          RefNull Fork
        </Link>
      </Box>
      <Box className="h-8 grow" />
      <LayoutBox className="self-center shrink-0 w-[400px] h-[400px] max-w-[100vw] max-h-[100vw]">
        {(rect) => <ImageCloud ref={cloudRef} rect={rect} />}
      </LayoutBox>
      <Box className="h-16 grow" />
      <WaveSea visible={!daemon} />
      {!daemon && config.showGithubLink ? <GithubLink /> : null}
    </Box>
  )
}
