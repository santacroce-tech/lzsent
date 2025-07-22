import type { SendResult } from '../lib'

interface TransactionResultProps {
    result: SendResult | null
    onClose: () => void
}

export function TransactionResult({ result, onClose }: TransactionResultProps) {
    if (!result) return null

    return (
        <div className="transaction-result">
            <div className="result-header">
                <h3>Transfer Successful! 🎉</h3>
                <button onClick={onClose} className="close-btn">&times;</button>
            </div>
            
            <div className="result-content">
                <div className="result-item">
                    <strong>Transaction Hash:</strong>
                    <code>{result.txHash}</code>
                </div>
                
                <div className="result-actions">
                    <a 
                        href={result.scanLink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                    >
                        View on LayerZero Scan
                    </a>
                    
                    <button onClick={onClose} className="btn btn-secondary">
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
} 