import { createContext } from 'react'

export interface ConfigValue {
  showGithubLink?: boolean
  getPhoto?(): Promise<string>
  savePhoto?(url: Blob): Promise<void>
  haptic?(): void
  segment?: {
    publicPath?: string
  }
}

export const defaultConfig: ConfigValue = {
  showGithubLink: true,
  segment: {
    publicPath: '/assets/background-removal/',
  },
}

export const ConfigContext = createContext<ConfigValue>(defaultConfig)

export default ConfigContext
