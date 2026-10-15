import {
  ConfigValue,
  ConfigContext,
  App as IdifyApp,
  defaultConfig,
} from '@idify/common'

const config: ConfigValue = defaultConfig

export default function App() {
  return (
    <ConfigContext.Provider value={config}>
      <IdifyApp />
    </ConfigContext.Provider>
  )
}
