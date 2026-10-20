if (import.meta.env.DEV) {
  if (typeof new URLSearchParams(location.search).get('debug') === 'string') {
    import('eruda').then(({ default: eruda }) => {
      eruda.init()
    })
  }
}
