import { useState } from 'react'
import { useOFTClient } from './hooks/useOFTClient'
import { ConnectionStatus } from './components/ConnectionStatus'
import { TransferForm } from './components/TransferForm'
import { TransactionResult } from './components/TransactionResult'
import type { SendResult } from './lib'

function App() {
    const oftClient = useOFTClient()
    const [transactionResult, setTransactionResult] = useState<SendResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleTransfer = (result: SendResult) => {
        console.log('📋 App: Received transfer result:', result)
        setTransactionResult(result)
        setError(null)
    }

    const handleError = (errorMessage: string) => {
        setError(errorMessage)
        setTransactionResult(null)
    }

    const handleCloseResult = () => {
        setTransactionResult(null)
    }

    const handleCloseError = () => {
        setError(null)
    }

    return (
        <div className="app">
            <header className="app-header">
                <h1>LZSent</h1>
                <p>Cross-Chain Token Transfer with LayerZero</p>
                <p>NO WARRANTY EXPRESSED OR IMPLIED.</p>
            </header>

            <main className="app-main">
                <ConnectionStatus oftClient={oftClient} />

                {error && (
                    <div className="error-banner">
                        <div className="error-content">
                            <strong>Error:</strong> {error}
                        </div>
                        <button onClick={handleCloseError} className="close-btn">
                            &times;
                        </button>
                    </div>
                )}

                {oftClient.isConnected && oftClient.client && (
                    <TransferForm
                        client={oftClient.client}
                        onTransfer={handleTransfer}
                        onError={handleError}
                    />
                )}

                <TransactionResult
                    result={transactionResult}
                    onClose={handleCloseResult}
                />
            </main>

            <footer className="app-footer">
                <p>Developed by <a href="https://x.com/robsantacroce" target="_blank" rel="noopener noreferrer">Rob Santacroce</a> using LLM's and having some fun. NO WARRANTY EXPRESSED OR IMPLIED.</p>
                <p>It's important to keep fun in computing. - Alan Perlis</p>
            </footer>
        </div>
    )
}

export default App 