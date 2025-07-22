import type { SendResult } from '../lib'

interface TransactionResultProps {
    result: SendResult | null
    onClose: () => void
}

export function TransactionResult({ result, onClose }: TransactionResultProps) {
    console.log('🔍 TransactionResult: Rendering with result:', result)
    console.log('🔍 TransactionResult: result.txHash:', result?.txHash)
    console.log('🔍 TransactionResult: result.scanLink:', result?.scanLink)
    
    if (!result) {
        console.log('🔍 TransactionResult: No result, not rendering')
        return null
    }

    console.log('🔍 TransactionResult: Rendering modal with result:', result)

    return (
        <>
            {/* Backdrop */}
            <div 
                className="modal-backdrop" 
                onClick={onClose}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 999,
                    backdropFilter: 'blur(5px)'
                }}
            />
            
            {/* Modal */}
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
                    
                    <div className="result-item">
                        <strong>LayerZero Scan Link:</strong>
                        <code>{result.scanLink}</code>
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
        </>
    )
} 