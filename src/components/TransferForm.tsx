import { useState, useEffect } from 'react'
import { OFTClient } from '../lib'
import type { QuoteResult, SendResult } from '../lib'
import { ethers } from 'ethers'

interface TransferFormProps {
    client: OFTClient
    onTransfer: (result: SendResult) => void
    onError: (error: string) => void
}

interface TransferData {
    srcEid: number
    dstEid: number
    amount: string
    to: string
    oftAddress: string
    minAmount: string
}

interface TokenInfo {
    name: string
    symbol: string
    decimals: number
    address: string
    totalSupply?: string
}

// Define adapter configurations with source and destination networks
interface AdapterConfig {
    address: string
    name: string
    srcNetwork: string
    dstNetwork: string
    srcEid: number
    dstEid: number
    description: string
}

const ADAPTER_CONFIGS: AdapterConfig[] = [
    {
        address: "0x681E68B9E70882D461f3b65e1Cfe09e1f251494D",
        name: "EURQ",
        srcNetwork: "Ethereum",
        dstNetwork: "Polygon",
        srcEid: 30101,
        dstEid: 30109,
        description: "EURQ (Ethereum → Polygon)"
    },
    {
        address: "0xCc1759221c2Ef0c069514F789d730508FEA1Da96",
        name: "EURQ",
        srcNetwork: "Polygon",
        dstNetwork: "Ethereum",
        srcEid: 30109,
        dstEid: 30101,
        description: "EURQ (Polygon → Ethereum)"
    }
]

export function TransferForm({ client, onTransfer, onError }: TransferFormProps) {
    const [transferData, setTransferData] = useState<TransferData>({
        srcEid: 30101,
        dstEid: 30102,
        amount: '1.000000',
        to: '',
        oftAddress: '',
        minAmount: ''
    })

    const [quote, setQuote] = useState<QuoteResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [quoteLoading, setQuoteLoading] = useState(false)
    const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
    const [debugInfo, setDebugInfo] = useState<string[]>([])
    const [approvalStatus, setApprovalStatus] = useState<'none' | 'checking' | 'needed' | 'approving' | 'approved' | 'failed'>('none')
    const [currentNetwork, setCurrentNetwork] = useState<string>('')
    const [currentSrcEid, setCurrentSrcEid] = useState<number>(0)
    const [adapterValidation, setAdapterValidation] = useState<{
        isValid: boolean
        error?: string
        selectedAdapter?: AdapterConfig
    }>({ isValid: false })

    // Get current network on component mount
    useEffect(() => {
        const getCurrentNetwork = async () => {
            try {
                const srcEid = await client.getCurrentSrcEid()
                setCurrentSrcEid(srcEid)
                
                // Map EID to network name
                const eidToNetwork: Record<number, string> = {
                    30101: 'Ethereum Mainnet',
                    30109: 'Polygon Mainnet',
                    30102: 'BSC Mainnet',
                    30106: 'Avalanche Mainnet',
                    30110: 'Arbitrum One',
                    30111: 'Optimism',
                    30112: 'Fantom'
                }
                setCurrentNetwork(eidToNetwork[srcEid] || `Unknown Network (${srcEid})`)
                
                // Update transfer data with current source network
                setTransferData(prev => ({ ...prev, srcEid }))
                
                // Automatically select the appropriate adapter for the current network
                const compatibleAdapter = ADAPTER_CONFIGS.find(config => config.srcEid === srcEid)
                if (compatibleAdapter) {
                    addDebugInfo(`🔄 Auto-selecting compatible adapter for ${eidToNetwork[srcEid]}: ${compatibleAdapter.description}`)
                    
                    // Validate and select the adapter
                    const isValidAdapter = validateAdapterSelection(compatibleAdapter.address)
                    if (isValidAdapter) {
                        // Set the adapter address and automatically set destination chain
                        setTransferData(prev => ({ 
                            ...prev, 
                            oftAddress: compatibleAdapter.address,
                            dstEid: compatibleAdapter.dstEid
                        }))
                        
                        // Get token info for the selected adapter
                        getTokenInfo(compatibleAdapter.address)
                        
                        addDebugInfo(`✅ Auto-selected adapter: ${compatibleAdapter.description}`)
                    } else {
                        addDebugInfo(`⚠️ Auto-selection failed: ${compatibleAdapter.description} is not compatible`)
                    }
                } else {
                    addDebugInfo(`ℹ️ No compatible adapter found for ${eidToNetwork[srcEid]} - manual selection required`)
                }
            } catch (error) {
                console.error('Failed to get current network:', error)
                setCurrentNetwork('Unknown Network')
                addDebugInfo(`❌ Failed to get current network: ${error}`)
            }
        }
        
        getCurrentNetwork()
    }, [client])

    const addDebugInfo = (message: string) => {
        console.log(`🔍 DEBUG: ${message}`)
        setDebugInfo(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
    }

    const clearDebugInfo = () => {
        setDebugInfo([])
    }

    // Validate adapter selection based on current network
    const validateAdapterSelection = (adapterAddress: string): AdapterConfig | null => {
        const adapter = ADAPTER_CONFIGS.find(config => config.address.toLowerCase() === adapterAddress.toLowerCase())
        
        if (!adapter) {
            setAdapterValidation({ isValid: false, error: 'Unknown adapter address' })
            return null
        }
        
        if (adapter.srcEid !== currentSrcEid) {
            setAdapterValidation({ 
                isValid: false, 
                error: `This adapter is for ${adapter.srcNetwork} network, but you are connected to ${currentNetwork}`,
                selectedAdapter: adapter
            })
            return null
        }
        
        setAdapterValidation({ isValid: true, selectedAdapter: adapter })
        return adapter
    }

    // Handle adapter selection from dropdown
    const handleAdapterSelection = (adapterAddress: string) => {
        if (!adapterAddress) {
            setTransferData(prev => ({ ...prev, oftAddress: '', dstEid: prev.srcEid }))
            setAdapterValidation({ isValid: false })
            return
        }
        
        const adapter = validateAdapterSelection(adapterAddress)
        if (adapter) {
            // Set the adapter address and automatically set destination chain
            setTransferData(prev => ({ 
                ...prev, 
                oftAddress: adapter.address,
                dstEid: adapter.dstEid
            }))
            
            // Get token info for the selected adapter
            getTokenInfo(adapter.address)
        }
    }

    // Clear adapter selection and reset form
    const clearAdapterSelection = () => {
        setTransferData(prev => ({ 
            ...prev, 
            oftAddress: '', 
            dstEid: prev.srcEid 
        }))
        setAdapterValidation({ isValid: false })
        setTokenInfo(null)
    }

    // Validate form before submission
    const isFormValid = (): boolean => {
        if (!transferData.oftAddress) return false
        if (!transferData.to) return false
        if (!transferData.amount) return false
        if (adapterValidation.selectedAdapter && !adapterValidation.isValid) return false
        return true
    }

    const checkAndHandleApproval = async (tokenAddress: string, oftAddress: string, amount: string, decimals: number) => {
        setApprovalStatus('checking')
        addDebugInfo('Checking token allowance...')
        
        try {
            const signer = await client.getSignerForExternal()
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function allowance(address owner, address spender) external view returns (uint256)',
                'function approve(address spender, uint256 amount) external returns (bool)'
            ], signer)
            
            const signerAddress = await signer.getAddress()
            const currentAllowance = await tokenContract.allowance(signerAddress, oftAddress)
            const amountToSend = ethers.parseUnits(amount, decimals)
            
            addDebugInfo(`Current allowance: ${ethers.formatUnits(currentAllowance, decimals)}`)
            addDebugInfo(`Required amount: ${ethers.formatUnits(amountToSend, decimals)}`)
            
            if (currentAllowance >= amountToSend) {
                setApprovalStatus('approved')
                addDebugInfo('✅ Sufficient allowance already exists')
                return true
            } else {
                setApprovalStatus('needed')
                addDebugInfo('⚠️ Insufficient allowance - approval needed')
                return false
            }
        } catch (error) {
            setApprovalStatus('failed')
            addDebugInfo(`❌ Could not check allowance: ${error}`)
            return false
        }
    }

    const handleApproval = async (tokenAddress: string, oftAddress: string, amount: string, decimals: number) => {
        setApprovalStatus('approving')
        addDebugInfo('Requesting token approval...')
        addDebugInfo('MetaMask popup should appear for approval...')
        
        try {
            const signer = await client.getSignerForExternal()
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function approve(address spender, uint256 amount) external returns (bool)',
                'function allowance(address owner, address spender) external view returns (uint256)'
            ], signer)
            
            const amountToSend = ethers.parseUnits(amount, decimals)
            
            // Request approval - this should trigger MetaMask popup
            addDebugInfo('Sending approval transaction...')
            const approveTx = await tokenContract.approve(oftAddress, amountToSend)
            addDebugInfo(`Approval transaction sent: ${approveTx.hash}`)
            addDebugInfo('Waiting for approval confirmation...')
            
            // Wait for confirmation
            const receipt = await approveTx.wait()
            addDebugInfo(`Approval confirmed in block: ${receipt.blockNumber}`)
            
            // Verify the new allowance
            const signerAddress = await signer.getAddress()
            const newAllowance = await tokenContract.allowance(signerAddress, oftAddress)
            
            if (newAllowance >= amountToSend) {
                setApprovalStatus('approved')
                addDebugInfo('✅ Approval successful')
                return true
            } else {
                setApprovalStatus('failed')
                addDebugInfo('❌ Approval failed - insufficient allowance after approval')
                return false
            }
        } catch (error) {
            setApprovalStatus('failed')
            addDebugInfo(`❌ Approval failed: ${error}`)
            return false
        }
    }

    const handleInputChange = (field: keyof TransferData, value: string | number) => {
        setTransferData(prev => ({ ...prev, [field]: value }))
        
        // If OFT address is manually changed, validate it and get token info
        if (field === 'oftAddress' && typeof value === 'string') {
            if (value) {
                // Check if it's one of our known adapters
                const adapter = ADAPTER_CONFIGS.find(config => config.address.toLowerCase() === value.toLowerCase())
                if (adapter) {
                    // This is a known adapter - validate and get token info
                    const isValidAdapter = validateAdapterSelection(value)
                    if (isValidAdapter) {
                        // Automatically set destination chain for known valid adapters
                        setTransferData(prev => ({ 
                            ...prev, 
                            dstEid: adapter.dstEid
                        }))
                    }
                    // Always get token info for known adapters
                    getTokenInfo(value)
                } else {
                    // For unknown addresses, clear validation and let user check manually
                    setAdapterValidation({ isValid: false })
                    
                    // Try to get token info for any valid address format
                    if (value.startsWith('0x') && value.length === 42) {
                        setApprovalStatus('none') // Reset approval status for new token
                        getTokenInfo(value)
                    }
                }
            } else {
                setAdapterValidation({ isValid: false })
                setTokenInfo(null) // Clear token info when address is cleared
            }
        }
    }

    const getTokenInfo = async (oftAddress: string) => {
        try {
            addDebugInfo(`Getting token info for OFT address: ${oftAddress}`)
            
            // Get token info directly from the OFT adapter
            const signer = await client.getSignerForExternal()
            const oft = new ethers.Contract(oftAddress, [
                'function token() external view returns (address)',
                'function name() external view returns (string)',
                'function symbol() external view returns (string)',
                'function decimals() external view returns (uint8)'
            ], signer)
            
            // First try to get the underlying token address
            let tokenAddress: string
            let tokenName: string
            let tokenSymbol: string
            let tokenDecimals: number
            let tokenTotalSupply: string
            
            try {
                // Try to get underlying token (for adapters)
                tokenAddress = await oft.token()
                addDebugInfo(`Underlying token address: ${tokenAddress}`)
                
                // Get token information from the underlying token
                const tokenContract = new ethers.Contract(tokenAddress, [
                    'function name() external view returns (string)',
                    'function symbol() external view returns (string)',
                    'function decimals() external view returns (uint8)',
                    'function totalSupply() external view returns (uint256)'
                ], signer)
                
                tokenName = await tokenContract.name()
                tokenSymbol = await tokenContract.symbol()
                tokenDecimals = await tokenContract.decimals()
                
                // Get total supply
                try {
                    const totalSupplyRaw = await tokenContract.totalSupply()
                    tokenTotalSupply = ethers.formatUnits(totalSupplyRaw, tokenDecimals)
                    addDebugInfo(`Total supply: ${tokenTotalSupply} ${tokenSymbol}`)
                } catch (supplyError) {
                    addDebugInfo(`Could not get total supply: ${supplyError}`)
                    tokenTotalSupply = 'Unknown'
                }
            } catch {
                // If that fails, try to get info directly from the OFT (for regular OFTs)
                addDebugInfo('Trying to get token info directly from OFT...')
                tokenAddress = oftAddress
                tokenName = await oft.name()
                tokenSymbol = await oft.symbol()
                tokenDecimals = await oft.decimals()
                
                // Try to get total supply from OFT
                try {
                    const totalSupplyRaw = await oft.totalSupply()
                    tokenTotalSupply = ethers.formatUnits(totalSupplyRaw, tokenDecimals)
                    addDebugInfo(`Total supply: ${tokenTotalSupply} ${tokenSymbol}`)
                } catch (supplyError) {
                    addDebugInfo(`Could not get total supply: ${supplyError}`)
                    tokenTotalSupply = 'Unknown'
                }
            }
            
            addDebugInfo(`Token Details - Name: ${tokenName}, Symbol: ${tokenSymbol}, Decimals: ${tokenDecimals}`)
            addDebugInfo(`Amount to send: ${transferData.amount} ${tokenSymbol}`)
            
            const tokenInfo = {
                name: tokenName,
                symbol: tokenSymbol,
                decimals: tokenDecimals,
                address: tokenAddress,
                totalSupply: tokenTotalSupply
            }
            
            setTokenInfo(tokenInfo)
        } catch (error) {
            addDebugInfo(`Could not get token info: ${error}`)
            setTokenInfo(null)
        }
    }

    const getQuote = async () => {
        clearDebugInfo()
        addDebugInfo('Starting quote process...')
        
        if (!transferData.amount || !transferData.to || !transferData.oftAddress) {
            onError('Please fill in all required fields')
            return
        }

        // Validate address format
        if (!transferData.oftAddress.startsWith('0x') || transferData.oftAddress.length !== 42) {
            onError('Invalid OFT adapter address format. Must be a valid Ethereum address.')
            return
        }

        if (!transferData.to.startsWith('0x') || transferData.to.length !== 42) {
            onError('Invalid recipient address format. Must be a valid Ethereum address.')
            return
        }

        // Validate amount
        const amount = parseFloat(transferData.amount)
        if (isNaN(amount) || amount <= 0) {
            onError('Invalid amount. Must be a positive number.')
            return
        }

        setQuoteLoading(true)
        setQuote(null)

        try {
            // Get the correct srcEid based on current network
            const currentSrcEid = await client.getCurrentSrcEid()
            addDebugInfo(`Current srcEid: ${currentSrcEid}`)
            
            // Update the transfer data with the correct srcEid
            const updatedTransferData = {
                ...transferData,
                srcEid: currentSrcEid
            }
            
            addDebugInfo(`Transfer data: ${JSON.stringify(updatedTransferData, null, 2)}`)
            
            const quoteResult = await client.quoteSend(updatedTransferData)
            setQuote(quoteResult)
            
            // Update token info if available
            if (quoteResult.tokenInfo) {
                setTokenInfo(quoteResult.tokenInfo)
            }
            
            addDebugInfo(`Quote successful - Native fee: ${quoteResult.nativeFee}, LZ fee: ${quoteResult.lzTokenFee}`)
        } catch (error) {
            console.error('Quote error:', error)
            addDebugInfo(`Quote error: ${error}`)
            const errorMessage = error instanceof Error ? error.message : 'Failed to get quote'
            onError(errorMessage)
        } finally {
            setQuoteLoading(false)
        }
    }

    const handleTransfer = async () => {
        clearDebugInfo()
        addDebugInfo('Starting transfer process...')
        
        if (!transferData.amount || !transferData.to || !transferData.oftAddress) {
            onError('Please fill in all required fields')
            return
        }

        // Validate address format
        if (!transferData.oftAddress.startsWith('0x') || transferData.oftAddress.length !== 42) {
            onError('Invalid OFT adapter address format. Must be a valid Ethereum address.')
            return
        }

        if (!transferData.to.startsWith('0x') || transferData.to.length !== 42) {
            onError('Invalid recipient address format. Must be a valid Ethereum address.')
            return
        }

        // Validate amount
        const amount = parseFloat(transferData.amount)
        if (isNaN(amount) || amount <= 0) {
            onError('Invalid amount. Must be a positive number.')
            return
        }

        setLoading(true)

        try {
            // Validate OFT adapter first
            addDebugInfo('Validating OFT adapter...')
            const validation = await client.validateOFTAdapter(transferData.oftAddress)
            if (!validation.isValid) {
                throw new Error(`OFT adapter validation failed: ${validation.error}`)
            }
            addDebugInfo('✅ OFT adapter validation passed')
            
            // Check network compatibility
            addDebugInfo('Checking network compatibility...')
            const networkCheck = await client.checkNetworkCompatibility(transferData.oftAddress)
            addDebugInfo(`Current network: ${networkCheck.currentNetwork}`)
            
            if (!networkCheck.isCompatible) {
                addDebugInfo(`❌ Network compatibility issue: ${networkCheck.error}`)
                if (networkCheck.recommendations) {
                    networkCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                }
                throw new Error(`Network compatibility issue: ${networkCheck.error}`)
            }
            addDebugInfo('✅ Network compatibility check passed')
            
            // Check OFT adapter support for specific destination and amount
            if (tokenInfo) {
                addDebugInfo('Checking OFT adapter support for destination and amount...')
                const supportCheck = await client.checkOFTAdapterSupport(
                    transferData.oftAddress,
                    transferData.dstEid,
                    transferData.amount,
                    tokenInfo.decimals
                )
                
                if (!supportCheck.isSupported) {
                    addDebugInfo(`❌ OFT adapter support issue: ${supportCheck.error}`)
                    if (supportCheck.recommendations) {
                        supportCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                    }
                    throw new Error(`OFT adapter support issue: ${supportCheck.error}`)
                }
                addDebugInfo('✅ OFT adapter support check passed')
            }
            
            // Get the correct srcEid based on current network
            const currentSrcEid = await client.getCurrentSrcEid()
            addDebugInfo(`Current srcEid: ${currentSrcEid}`)
            
            // Update the transfer data with the correct srcEid
            const updatedTransferData = {
                ...transferData,
                srcEid: currentSrcEid
            }
            
            addDebugInfo(`Transfer data: ${JSON.stringify(updatedTransferData, null, 2)}`)
            
            // Get signer address for debugging
            const signerAddress = await client.getSignerAddress()
            addDebugInfo(`Signer address: ${signerAddress}`)
            
            // Check balance before transfer
            const signer = await client.getSignerForExternal()
            const balance = await signer.provider.getBalance(signerAddress)
            addDebugInfo(`Signer ETH balance: ${ethers.formatEther(balance)} ETH`)
            
            // Check token balance if we have token info
            if (tokenInfo) {
                try {
                    const tokenContract = new ethers.Contract(tokenInfo.address, [
                        'function balanceOf(address owner) external view returns (uint256)',
                        'function allowance(address owner, address spender) external view returns (uint256)'
                    ], signer)
                    
                    const tokenBalance = await tokenContract.balanceOf(signerAddress)
                    const tokenBalanceFormatted = ethers.formatUnits(tokenBalance, tokenInfo.decimals)
                    addDebugInfo(`Token balance: ${tokenBalanceFormatted} ${tokenInfo.symbol}`)
                    
                    // Check allowance for OFT adapter
                    const allowance = await tokenContract.allowance(signerAddress, transferData.oftAddress)
                    const allowanceFormatted = ethers.formatUnits(allowance, tokenInfo.decimals)
                    addDebugInfo(`Allowance for OFT: ${allowanceFormatted} ${tokenInfo.symbol}`)
                    
                    // Check if we have enough balance
                    const amountToSend = ethers.parseUnits(transferData.amount, tokenInfo.decimals)
                    if (tokenBalance < amountToSend) {
                        throw new Error(`Insufficient token balance. Have: ${tokenBalanceFormatted} ${tokenInfo.symbol}, Need: ${transferData.amount} ${tokenInfo.symbol}`)
                    }
                    
                    // Check and handle approval
                    const hasSufficientAllowance = await checkAndHandleApproval(
                        tokenInfo.address, 
                        transferData.oftAddress, 
                        transferData.amount, 
                        tokenInfo.decimals
                    )
                    
                    if (!hasSufficientAllowance) {
                        addDebugInfo('Approval needed before transfer')
                        addDebugInfo('Requesting approval from MetaMask...')
                        
                        const approvalSuccess = await handleApproval(
                            tokenInfo.address, 
                            transferData.oftAddress, 
                            transferData.amount, 
                            tokenInfo.decimals
                        )
                        
                        if (!approvalSuccess) {
                            throw new Error('Token approval failed. Please try again.')
                        }
                        
                        addDebugInfo('✅ Approval successful, proceeding with transfer...')
                    } else {
                        addDebugInfo('✅ Sufficient allowance already exists')
                    }
                } catch (error) {
                    addDebugInfo(`Could not check token balance: ${error}`)
                }
            }
            
            const result = await client.sendTokens(updatedTransferData)
            console.log('🔍 TransferForm: Received result from sendTokens:', result)
            console.log('🔍 TransferForm: result.txHash:', result.txHash)
            console.log('🔍 TransferForm: result.scanLink:', result.scanLink)
            console.log('🔍 TransferForm: result type:', typeof result)
            console.log('🔍 TransferForm: result keys:', Object.keys(result))
            
            addDebugInfo(`Transfer successful! TX Hash: ${result.txHash}`)
            addDebugInfo(`LayerZero Scan Link: ${result.scanLink}`)
            
            // Call the onTransfer callback to show the result modal
            console.log('🎉 Transfer completed successfully!')
            console.log('Transaction result:', result)
            onTransfer(result)
            setQuote(null)
        } catch (error) {
            console.error('Transfer error:', error)
            addDebugInfo(`Transfer error: ${error}`)
            
            // Enhanced error analysis
            if (error instanceof Error) {
                const errorMessage = error.message
                addDebugInfo(`Error message: ${errorMessage}`)
                
                // Check for specific error patterns
                if (errorMessage.includes('execution reverted')) {
                    addDebugInfo('Transaction reverted - this usually means a smart contract validation failed')
                    addDebugInfo('Common causes: insufficient balance, insufficient allowance, invalid parameters')
                }
                
                if (errorMessage.includes('require(false)')) {
                    addDebugInfo('Smart contract has a require(false) condition - this indicates a validation failure')
                    addDebugInfo('Check: token balance, allowance, network compatibility, parameter validity')
                }
                
                if (errorMessage.includes('insufficient funds')) {
                    addDebugInfo('Insufficient ETH for gas fees')
                }
                
                if (errorMessage.includes('user rejected')) {
                    addDebugInfo('User rejected the transaction in MetaMask')
                }
            }
            
            const errorMessage = error instanceof Error ? error.message : 'Transfer failed'
            onError(errorMessage)
        } finally {
            setLoading(false)
        }
    }

    const formatEther = (wei: string) => {
        return (parseInt(wei) / 1e18).toFixed(6)
    }

    return (
        <div className="transfer-form">
            <h2>Cross-Chain Token Transfer</h2>
            
            {/* Network Status Indicator */}
            <div className="network-status" style={{
                background: '#e3f2fd',
                border: '1px solid #2196f3',
                borderRadius: '8px',
                padding: '1rem',
                marginBottom: '1rem',
                textAlign: 'center'
            }}>
                <strong>🌐 Current Network: {currentNetwork}</strong>
                <br />
                <small>Source Chain ID: {currentSrcEid}</small>
                {adapterValidation.selectedAdapter && adapterValidation.isValid && (
                    <>
                        <br />
                        <div style={{ 
                            marginTop: '0.5rem', 
                            padding: '0.5rem', 
                            background: '#e8f5e8', 
                            borderRadius: '4px',
                            border: '1px solid #4caf50'
                        }}>
                            <strong>🎯 Auto-selected Adapter:</strong>
                            <br />
                            <small>{adapterValidation.selectedAdapter.description}</small>
                        </div>
                    </>
                )}
            </div>
            
            <div className="form-group">
                <label htmlFor="oftAddress">OFT Adapter Address:</label>
                <div className="field-help">
                    Choose the OFT adapter contract address for the token.
                    <br />
                    <small>⚠️ Only select adapters compatible with your current network</small>
                </div>
                
                <div style={{ marginBottom: '1rem' }}>
                    <label htmlFor="commonOFT" style={{ fontSize: '0.9rem', color: '#6c757d' }}>
                        Quick select common tokens:
                        {adapterValidation.selectedAdapter && adapterValidation.isValid && (
                            <span style={{ 
                                marginLeft: '0.5rem', 
                                color: '#2e7d32', 
                                fontWeight: '500' 
                            }}>
                                ✅ Auto-selected
                            </span>
                        )}
                    </label>
                    <select
                        id="commonOFT"
                        value={transferData.oftAddress}
                        onChange={(e) => {
                            if (e.target.value) {
                                handleAdapterSelection(e.target.value)
                            }
                        }}
                        style={{ 
                            width: '100%', 
                            padding: '0.5rem', 
                            marginTop: '0.25rem',
                            fontSize: '0.9rem'
                        }}
                    >
                        <option value="">Select a common token...</option>
                        {ADAPTER_CONFIGS.map(config => (
                            <option key={config.address} value={config.address}>
                                {config.name} ({config.srcNetwork} → {config.dstNetwork}) - {config.address}
                                {config.address === transferData.oftAddress && adapterValidation.isValid ? ' (Auto-selected)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
                
                <input
                    type="text"
                    id="oftAddress"
                    value={transferData.oftAddress}
                    onChange={(e) => handleInputChange('oftAddress', e.target.value)}
                    placeholder="0x1234567890abcdef..."
                    required
                    disabled={!!adapterValidation.selectedAdapter}
                    style={{ 
                        borderColor: adapterValidation.isValid ? 'initial' : 'red',
                        backgroundColor: adapterValidation.selectedAdapter ? '#f5f5f5' : 'white'
                    }}
                />
                
                {/* Clear Adapter Button */}
                {adapterValidation.selectedAdapter && (
                    <button
                        type="button"
                        onClick={clearAdapterSelection}
                        style={{
                            marginTop: '0.5rem',
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.8rem',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        🗑️ Clear Adapter Selection
                    </button>
                )}
                
                {/* Adapter Validation Messages */}
                {adapterValidation.selectedAdapter && !adapterValidation.isValid && (
                    <div className="validation-error" style={{ 
                        color: '#d32f2f', 
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        background: '#ffebee',
                        border: '1px solid #f44336',
                        borderRadius: '4px'
                    }}>
                        <strong>⚠️ Incompatible Adapter Selected:</strong>
                        <p>{adapterValidation.error}</p>
                        <p>Please select an adapter that is compatible with your current network ({currentNetwork}).</p>
                    </div>
                )}
                
                {adapterValidation.selectedAdapter && adapterValidation.isValid && (
                    <div className="validation-success" style={{ 
                        color: '#2e7d32', 
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        background: '#e8f5e8',
                        border: '1px solid #4caf50',
                        borderRadius: '4px'
                    }}>
                        <strong>✅ Compatible Adapter Selected:</strong>
                        <p>{adapterValidation.selectedAdapter.description}</p>
                        <p>Destination chain will be automatically set to {adapterValidation.selectedAdapter.dstNetwork}.</p>
                    </div>
                )}
                
                {/* Token Supply Information */}
                {adapterValidation.selectedAdapter && adapterValidation.isValid && tokenInfo && (
                    <div style={{
                        background: '#f0f8ff',
                        border: '1px solid #2196f3',
                        borderRadius: '4px',
                        padding: '0.75rem',
                        marginTop: '0.5rem'
                    }}>
                        <strong>💰 Token Information:</strong>
                        <div style={{ marginTop: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: '500' }}>Token Symbol:</span>
                                <span style={{ 
                                    backgroundColor: '#e3f2fd', 
                                    padding: '0.25rem 0.5rem', 
                                    borderRadius: '4px',
                                    fontSize: '0.9rem',
                                    fontWeight: '600'
                                }}>
                                    {tokenInfo.symbol}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                <span style={{ fontWeight: '500' }}>Decimals:</span>
                                <span style={{ 
                                    backgroundColor: '#fff3e0', 
                                    padding: '0.25rem 0.5rem', 
                                    borderRadius: '4px',
                                    fontSize: '0.9rem',
                                    fontWeight: '600'
                                }}>
                                    {tokenInfo.decimals}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: '500' }}>Total Supply:</span>
                                <span style={{ 
                                    backgroundColor: '#e8f5e8', 
                                    padding: '0.25rem 0.5rem', 
                                    borderRadius: '4px',
                                    fontSize: '0.9rem',
                                    fontWeight: '600'
                                }}>
                                    {!tokenInfo.totalSupply || tokenInfo.totalSupply === 'Unknown' ? 'Unknown' : `${parseFloat(tokenInfo.totalSupply).toLocaleString()} ${tokenInfo.symbol}`}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Warning for manually entered addresses */}
                {transferData.oftAddress && !adapterValidation.selectedAdapter && (
                    <div className="validation-warning" style={{ 
                        color: '#f57c00', 
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        background: '#fff3e0',
                        border: '1px solid #ff9800',
                        borderRadius: '4px'
                    }}>
                        <strong>⚠️ Custom OFT Address Entered:</strong>
                        <p>This address is not in our known adapter list. Please verify it's compatible with your current network ({currentNetwork}).</p>
                        <p>Use the "Check OFT" button below to validate this address.</p>
                    </div>
                )}

                {/* Hidden Token Details Section - Removed as requested */}
                {/* {tokenInfo && (
                    <div className="token-details-display">
                        <h3>🎯 Token Details</h3>
                        <div className="token-details-grid">
                            <div className="token-detail-item">
                                <span className="detail-label">Name:</span>
                                <span className="detail-value">{tokenInfo.name}</span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Symbol:</span>
                                <span className="detail-value">{tokenInfo.symbol}</span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Decimals:</span>
                                <span className="detail-value">{tokenInfo.decimals}</span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Total Supply:</span>
                                <span className="detail-value">
                                    {!tokenInfo.totalSupply || tokenInfo.totalSupply === 'Unknown' ? 'Unknown' : `${parseFloat(tokenInfo.totalSupply).toLocaleString()} ${tokenInfo.symbol}`}
                                </span>
                            </div>
                            <div className="token-detail-item">
                                <span className="detail-label">Amount to send:</span>
                                <span className="detail-value">{transferData.amount} {tokenInfo.symbol}</span>
                            </div>
                        </div>
                    </div>
                )} */}
            </div>

            <div className="form-group">
                <label htmlFor="dstEid">Destination Network:</label>
                {adapterValidation.selectedAdapter && adapterValidation.isValid ? (
                    <div style={{
                        background: '#e8f5e8',
                        border: '1px solid #4caf50',
                        borderRadius: '4px',
                        padding: '0.75rem',
                        marginBottom: '0.5rem'
                    }}>
                        <strong>🎯 Automatically set to: {adapterValidation.selectedAdapter.dstNetwork}</strong>
                        <br />
                        <small>Based on your selected OFT adapter</small>
                    </div>
                ) : (
                    <div className="field-help">
                        <small>Select destination network manually, or choose an OFT adapter above to auto-select</small>
                    </div>
                )}
                
                <select
                    id="dstEid"
                    value={transferData.dstEid}
                    onChange={(e) => handleInputChange('dstEid', parseInt(e.target.value))}
                    disabled={!!adapterValidation.selectedAdapter && adapterValidation.isValid}
                    style={{
                        backgroundColor: adapterValidation.selectedAdapter && adapterValidation.isValid ? '#f5f5f5' : 'white'
                    }}
                >
                    <option value={30101}>Ethereum Mainnet (30101)</option>
                    <option value={30109}>Polygon Mainnet (30109)</option>
                </select>
            </div>

            <div className="form-group">
                <label htmlFor="to">Recipient Address:</label>
                <input
                    type="text"
                    id="to"
                    value={transferData.to}
                    onChange={(e) => handleInputChange('to', e.target.value)}
                    placeholder="0x1234567890abcdef..."
                    required
                />
            </div>

            <div className="form-group">
                <label htmlFor="amount">Amount:</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                        type="text"
                        id="amount"
                        value={transferData.amount}
                        onChange={(e) => handleInputChange('amount', e.target.value)}
                        placeholder="1.000000"
                        required
                        style={{ flex: 1 }}
                    />
                    {tokenInfo && (
                        <span style={{
                            padding: '0.5rem 0.75rem',
                            backgroundColor: '#f8f9fa',
                            border: '1px solid #dee2e6',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                            color: '#495057',
                            minWidth: 'fit-content'
                        }}>
                            {tokenInfo.symbol}
                        </span>
                    )}
                </div>
                {tokenInfo && (
                    <small style={{ color: '#6c757d', marginTop: '0.25rem', display: 'block' }}>
                        Token: {tokenInfo.name} ({tokenInfo.symbol})
                    </small>
                )}
            </div>

            <div className="form-actions">
                <button
                    type="button"
                    onClick={getQuote}
                    disabled={quoteLoading || !isFormValid()}
                    className="btn btn-secondary"
                >
                    {quoteLoading ? 'Getting Quote...' : 'Get Quote'}
                </button>
                
                <button
                    type="button"
                    onClick={handleTransfer}
                    disabled={loading || !isFormValid()}
                    className="btn btn-primary"
                >
                    {loading ? 'Sending...' : 'Send Tokens'}
                </button>
                
                <button
                    type="button"
                    onClick={async () => {
                        clearDebugInfo()
                        addDebugInfo('🔍 Manual OFT adapter check...')
                        
                        if (!transferData.oftAddress) {
                            addDebugInfo('❌ No OFT address provided')
                            return
                        }
                        
                        try {
                            // Check network compatibility
                            addDebugInfo('Checking network compatibility...')
                            const networkCheck = await client.checkNetworkCompatibility(transferData.oftAddress)
                            addDebugInfo(`Current network: ${networkCheck.currentNetwork}`)
                            
                            if (networkCheck.isCompatible) {
                                addDebugInfo('✅ Network compatibility check passed')
                                if (networkCheck.recommendations) {
                                    networkCheck.recommendations.forEach(rec => addDebugInfo(`💡 ${rec}`))
                                }
                            } else {
                                addDebugInfo(`❌ Network compatibility issue: ${networkCheck.error}`)
                                if (networkCheck.recommendations) {
                                    networkCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                                }
                            }
                            
                            // Validate OFT adapter
                            addDebugInfo('Validating OFT adapter...')
                            const validation = await client.validateOFTAdapter(transferData.oftAddress)
                            if (validation.isValid) {
                                addDebugInfo('✅ OFT adapter validation passed')
                            } else {
                                addDebugInfo(`❌ OFT adapter validation failed: ${validation.error}`)
                            }
                            
                            // Check OFT adapter support for specific destination and amount
                            if (tokenInfo) {
                                addDebugInfo('Checking OFT adapter support for destination and amount...')
                                const supportCheck = await client.checkOFTAdapterSupport(
                                    transferData.oftAddress,
                                    transferData.dstEid,
                                    transferData.amount,
                                    tokenInfo.decimals
                                )
                                
                                if (supportCheck.isSupported) {
                                    addDebugInfo('✅ OFT adapter support check passed')
                                    if (supportCheck.recommendations) {
                                        supportCheck.recommendations.forEach(rec => addDebugInfo(`💡 ${rec}`))
                                    }
                                } else {
                                    addDebugInfo(`❌ OFT adapter support issue: ${supportCheck.error}`)
                                    if (supportCheck.recommendations) {
                                        supportCheck.recommendations.forEach(rec => addDebugInfo(`💡 Recommendation: ${rec}`))
                                    }
                                }
                            } else {
                                addDebugInfo('⚠️ No token info available for support check')
                            }
                            
                        } catch (error) {
                            addDebugInfo(`❌ Check failed: ${error}`)
                        }
                    }}
                    className="btn btn-small"
                    style={{ backgroundColor: '#6c757d', color: 'white' }}
                    disabled={!transferData.oftAddress}
                >
                    Check OFT
                </button>
            </div>

            {/* Approval Status Indicator */}
            {approvalStatus !== 'none' && (
                <div className="approval-status" style={{
                    background: approvalStatus === 'approved' ? '#d4edda' : 
                               approvalStatus === 'failed' ? '#f8d7da' : 
                               approvalStatus === 'approving' ? '#fff3cd' : '#e2e3e5',
                    border: approvalStatus === 'approved' ? '1px solid #c3e6cb' : 
                            approvalStatus === 'failed' ? '1px solid #f5c6cb' : 
                            approvalStatus === 'approving' ? '1px solid #ffeaa7' : '1px solid #d1ecf1',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginTop: '1rem',
                    textAlign: 'center'
                }}>
                    {approvalStatus === 'checking' && (
                        <div>
                            <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
                            <strong>Checking token allowance...</strong>
                        </div>
                    )}
                    {approvalStatus === 'needed' && (
                        <div>
                            <strong style={{ color: '#856404' }}>⚠️ Token approval needed</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#856404' }}>
                                You need to approve the OFT adapter to spend your tokens before transferring.
                            </p>
                        </div>
                    )}
                    {approvalStatus === 'approving' && (
                        <div>
                            <div className="spinner" style={{ margin: '0 auto 0.5rem' }}></div>
                            <strong style={{ color: '#856404' }}>Approving tokens...</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#856404' }}>
                                Please confirm the approval transaction in MetaMask.
                            </p>
                        </div>
                    )}
                    {approvalStatus === 'approved' && (
                        <div>
                            <strong style={{ color: '#155724' }}>✅ Token approval successful</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#155724' }}>
                                You can now proceed with the transfer.
                            </p>
                        </div>
                    )}
                    {approvalStatus === 'failed' && (
                        <div>
                            <strong style={{ color: '#721c24' }}>❌ Token approval failed</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#721c24' }}>
                                Please try the approval again or check your MetaMask connection.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {quote && (
                <div className="quote-display">
                    <h3>Transfer Quote</h3>
                    <div className="quote-item">
                        <span>Native Fee:</span>
                        <span>{formatEther(quote.nativeFee.toString())} ETH</span>
                    </div>
                    <div className="quote-item">
                        <span>LZ Token Fee:</span>
                        <span>{formatEther(quote.lzTokenFee.toString())} LZ</span>
                    </div>
                </div>
            )}

            {/* Debug Information */}
            {debugInfo.length > 0 && (
                <div className="debug-info">
                    <h3>🔍 Debug Information</h3>
                    <button 
                        onClick={clearDebugInfo}
                        className="btn btn-small"
                        style={{ marginBottom: '10px' }}
                    >
                        Clear Debug
                    </button>
                    <div className="debug-log">
                        {debugInfo.map((info, index) => (
                            <div key={index} className="debug-line">
                                {info}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
} 