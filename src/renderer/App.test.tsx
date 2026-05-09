import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import App from './App'

describe('App', () => {
  it('renders navigation', () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>
    )
    expect(screen.getByText('PrivateAI Launcher')).toBeInTheDocument()
    expect(screen.getByText('Hardware Doctor')).toBeInTheDocument()
  })
})
