import React from 'react'
import ReactDOM from 'react-dom/client'
import { StarknetProvider } from './starknet-provider'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StarknetProvider>
      <App />
    </StarknetProvider>
  </React.StrictMode>,
)
