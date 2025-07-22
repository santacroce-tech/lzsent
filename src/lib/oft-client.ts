import { ethers, parseUnits } from 'ethers'
import { ChainType, endpointIdToChainType } from '@layerzerolabs/lz-definitions'
import { Options, addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

import type { 
    EvmSendArgs, 
    SendResult, 
    QuoteResult, 
    OFTConfig,
    MetaMaskProvider 
} from './types'
import { getLayerZeroScanLink } from './utils'

// IOFT ABI - comprehensive interface for OFT operations
const IOFT_ABI = [
    'function token() external view returns (address)',
    'function approvalRequired() external view returns (bool)',
    'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)',
    'function send(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns (bytes32 guid)',
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)',
    'function name() external view returns (string)'
]

// IERC20 ABI - minimal interface for ERC20 operations
const IERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function approve(address spender, uint256 amount) external returns (bool)'
]

export class OFTClient {
    private provider: ethers.BrowserProvider

    constructor(metaMaskProvider: MetaMaskProvider) {
        this.provider = new ethers.BrowserProvider(metaMaskProvider)
    }

    private async getSigner(): Promise<ethers.JsonRpcSigner> {
        return await this.provider.getSigner()
    }

    /**
     * Get the signer for external use
     */
    async getSignerForExternal(): Promise<ethers.JsonRpcSigner> {
        return await this.getSigner()
    }

    /**
     * Get OFT configuration
     */
    async getOFTConfig(oftAddress: string): Promise<OFTConfig> {
        try {
            const signer = await this.getSigner()
            const oft = new ethers.Contract(oftAddress, IOFT_ABI, signer)
            
            // First, verify the contract exists and has the required functions
            try {
                const code = await this.provider.getCode(oftAddress)
                if (code === '0x') {
                    throw new Error('Contract does not exist at this address')
                }
            } catch (error) {
                throw new Error(`Failed to verify contract at ${oftAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
            
            const underlying = await oft.token()
            const erc20 = new ethers.Contract(underlying, IERC20_ABI, signer)
            
            let decimals: number
            let approvalRequired: boolean
            
            try {
                decimals = await erc20.decimals()
            } catch {
                // Try to get decimals from the OFT contract itself
                try {
                    decimals = await oft.decimals()
                } catch {
                    // Fallback to 6 decimals if not available
                    decimals = 6
                }
            }
            
            try {
                approvalRequired = await oft.approvalRequired()
            } catch {
                // Assume approval not required if method doesn't exist
                approvalRequired = false
            }

            return {
                address: oftAddress,
                underlyingToken: underlying,
                decimals,
                approvalRequired
            }
        } catch (error) {
            console.error('OFT config error:', error)
            throw new Error(`Failed to get OFT configuration: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
    }

    /**
     * Check and handle ERC20 approval for OFT adapters
     */
    async handleApproval(oftAddress: string, amount: string, decimals: number): Promise<void> {
        const signer = await this.getSigner()
        const oft = new ethers.Contract(oftAddress, IOFT_ABI, signer)
        
        try {
            const approvalRequired = await oft.approvalRequired()
            if (!approvalRequired) {
                return // No approval needed
            }

            const underlying = await oft.token()
            const erc20 = new ethers.Contract(underlying, IERC20_ABI, signer)
            
            const amountUnits = parseUnits(amount, decimals)
            const currentAllowance = await erc20.allowance(await signer.getAddress(), oftAddress)
            
            if (currentAllowance.lt(amountUnits)) {
                const approveTx = await erc20.approve(oftAddress, amountUnits)
                await approveTx.wait()
            }
        } catch {
            // If approvalRequired() doesn't exist, assume it's a regular OFT
            console.log('No approval required (regular OFT detected)')
        }
    }

    /**
     * Build LayerZero options
     */
    buildOptions(args: EvmSendArgs): string {
        let options = Options.newOptions()

        // Add lzReceive options
        if (args.extraLzReceiveOptions && args.extraLzReceiveOptions.length > 0) {
            if (args.extraLzReceiveOptions.length % 2 !== 0) {
                throw new Error('Invalid lzReceive options: expected pairs of gas,value')
            }

            for (let i = 0; i < args.extraLzReceiveOptions.length; i += 2) {
                const gas = Number(args.extraLzReceiveOptions[i])
                const value = Number(args.extraLzReceiveOptions[i + 1]) || 0
                options = options.addExecutorLzReceiveOption(gas, value)
            }
        }

        // Add lzCompose options
        if (args.extraLzComposeOptions && args.extraLzComposeOptions.length > 0) {
            if (args.extraLzComposeOptions.length % 3 !== 0) {
                throw new Error('Invalid lzCompose options: expected triplets of index,gas,value')
            }

            for (let i = 0; i < args.extraLzComposeOptions.length; i += 3) {
                const index = Number(args.extraLzComposeOptions[i])
                const gas = Number(args.extraLzComposeOptions[i + 1])
                const value = Number(args.extraLzComposeOptions[i + 2]) || 0
                options = options.addExecutorComposeOption(index, gas, value)
            }
        }

        // Add native drop options
        if (args.extraNativeDropOptions && args.extraNativeDropOptions.length > 0) {
            if (args.extraNativeDropOptions.length % 2 !== 0) {
                throw new Error('Invalid native drop options: expected pairs of amount,recipient')
            }

            for (let i = 0; i < args.extraNativeDropOptions.length; i += 2) {
                const amountStr = args.extraNativeDropOptions[i]
                const recipient = args.extraNativeDropOptions[i + 1]

                if (!amountStr || !recipient) {
                    throw new Error('Invalid native drop option: Both amount and recipient must be provided')
                }

                try {
                    options = options.addExecutorNativeDropOption(amountStr.trim(), recipient.trim())
                } catch (error) {
                    const maxUint128 = BigInt('340282366920938463463374607431768211455')
                    const maxUint128Ether = Number(maxUint128) / 1e18

                    throw new Error(
                        `Failed to add native drop option with amount ${amountStr.trim()} wei. ` +
                        `LayerZero protocol constrains native drop amounts to uint128 maximum ` +
                        `(${maxUint128.toString()} wei ≈ ${maxUint128Ether.toFixed(2)} ETH). ` +
                        `Original error: ${error instanceof Error ? error.message : String(error)}`
                    )
                }
            }
        }

        return options.toHex()
    }

    /**
     * Quote the transaction fee
     */
    async quoteSend(args: EvmSendArgs): Promise<QuoteResult> {
        if (endpointIdToChainType(args.srcEid) !== ChainType.EVM) {
            throw new Error(`non-EVM srcEid (${args.srcEid}) not supported`)
        }

        try {
            console.log('Getting OFT config for address:', args.oftAddress)
            console.log('Source EID:', args.srcEid)
            console.log('Destination EID:', args.dstEid)
            
            // Check current network
            const network = await this.provider.getNetwork()
            console.log('Current network chainId:', Number(network.chainId))
            
                        const oftConfig = await this.getOFTConfig(args.oftAddress)
            console.log('OFT config:', oftConfig)
            
            let tokenInfo: { name: string; symbol: string; decimals: number; address: string } | null = null
            
            // Try to get the token address to verify this is a valid OFT adapter
            try {
                const signer = await this.getSigner()
                const oft = new ethers.Contract(args.oftAddress, IOFT_ABI, signer)
                const tokenAddress = await oft.token()
                console.log('Underlying token address:', tokenAddress)
                
                // Get token information
                const tokenContract = new ethers.Contract(tokenAddress, [
                    'function name() external view returns (string)',
                    'function symbol() external view returns (string)',
                    'function decimals() external view returns (uint8)'
                ], signer)
                
                try {
                    const tokenName = await tokenContract.name()
                    const tokenSymbol = await tokenContract.symbol()
                    const tokenDecimals = await tokenContract.decimals()
                    console.log('🎯 Token Details:')
                    console.log('  Name:', tokenName)
                    console.log('  Symbol:', tokenSymbol)
                    console.log('  Decimals:', tokenDecimals)
                    console.log('  Amount to send:', args.amount, tokenSymbol)
                    
                    tokenInfo = {
                        name: tokenName,
                        symbol: tokenSymbol,
                        decimals: tokenDecimals,
                        address: tokenAddress
                    }
                } catch (tokenError) {
                    console.log('Could not get token details:', tokenError)
                }
                
                // Also check if the contract has code
                const code = await this.provider.getCode(args.oftAddress)
                if (code === '0x') {
                    console.error('❌ Contract has no code - not deployed on this network!')
                    throw new Error('OFT adapter is not deployed on the current network')
                } else {
                    console.log('✅ Contract has code - deployed on this network')
                }
            } catch (error) {
                console.log('Could not get token address:', error)
                if (error instanceof Error && error.message.includes('not deployed')) {
                    throw error
                }
            }
            
            const amountUnits = parseUnits(args.amount, oftConfig.decimals)
            const minAmountUnits = args.minAmount 
                ? parseUnits(args.minAmount, oftConfig.decimals) 
                : amountUnits

            console.log('Amount units:', amountUnits.toString())
            console.log('Min amount units:', minAmountUnits.toString())

            const toBytes = addressToBytes32(args.to)
            const extraOptions = this.buildOptions(args)

            console.log('To bytes:', ethers.hexlify(toBytes))
            console.log('Extra options:', extraOptions)

            // Build sendParam object
            const sendParam = {
                dstEid: args.dstEid,
                to: ethers.hexlify(toBytes),
                amountLD: amountUnits.toString(),
                minAmountLD: minAmountUnits.toString(),
                extraOptions: extraOptions,
                composeMsg: args.composeMsg || '0x',
                oftCmd: '0x',
            }

            console.log('Calling quoteSend with sendParam object...')
            console.log('Parameters:', sendParam)

            const signer = await this.getSigner()
            const oft = new ethers.Contract(args.oftAddress, IOFT_ABI, signer)
            
            console.log('Calling quoteSend...')
            // Call quoteSend with sendParam object and false for payInLzToken
            const result = await oft.quoteSend(sendParam, false)
            console.log('Quote result:', result)

            return {
                nativeFee: result[0],
                lzTokenFee: result[1],
                tokenInfo: tokenInfo || undefined
            }
        } catch (error) {
            console.error('Quote error:', error)
            if (error instanceof Error) {
                throw new Error(`Failed to get quote: ${error.message}`)
            }
            throw new Error('Failed to get quote: Unknown error')
        }
    }

    /**
     * Send tokens cross-chain
     */
    async sendTokens(args: EvmSendArgs): Promise<SendResult> {
        if (endpointIdToChainType(args.srcEid) !== ChainType.EVM) {
            throw new Error(`non-EVM srcEid (${args.srcEid}) not supported`)
        }

        const oftConfig = await this.getOFTConfig(args.oftAddress)
        
        // Handle approval if needed
        await this.handleApproval(args.oftAddress, args.amount, oftConfig.decimals)

        const amountUnits = parseUnits(args.amount, oftConfig.decimals)
        const minAmountUnits = args.minAmount 
            ? parseUnits(args.minAmount, oftConfig.decimals) 
            : amountUnits

        const toBytes = addressToBytes32(args.to)
        const extraOptions = this.buildOptions(args)



        // Quote the fee
        const msgFee = await this.quoteSend(args)

        // Send the transaction
        const signer = await this.getSigner()
        const oft = new ethers.Contract(args.oftAddress, IOFT_ABI, signer)
        const refundAddress = await signer.getAddress()
        
        const tx = await oft.send(
            args.dstEid,
            ethers.hexlify(toBytes),
            amountUnits,
            minAmountUnits,
            extraOptions,
            args.composeMsg || '0x',
            '0x', // oftCmd
            [msgFee.nativeFee, msgFee.lzTokenFee], // fee tuple
            refundAddress,
            {
                value: msgFee.nativeFee,
            }
        )

        const receipt = await tx.wait()
        const txHash = receipt.transactionHash
        const scanLink = getLayerZeroScanLink(txHash, args.srcEid >= 40_000 && args.srcEid < 50_000)

        return { txHash, scanLink }
    }

    /**
     * Get signer address
     */
    async getSignerAddress(): Promise<string> {
        const signer = await this.getSigner()
        return await signer.getAddress()
    }

    /**
     * Get current network chain ID
     */
    async getChainId(): Promise<number> {
        const network = await this.provider.getNetwork()
        return Number(network.chainId)
    }

    /**
     * Get the correct srcEid based on current network
     */
    async getCurrentSrcEid(): Promise<number> {
        const chainId = await this.getChainId()
        
        // Map chainId to LayerZero EID
        const chainIdToEid: Record<number, number> = {
            1: 30101,      // Ethereum Mainnet
            56: 30102,     // BSC Mainnet
            137: 30109,    // Polygon Mainnet
            43114: 30106,  // Avalanche Mainnet
            42161: 30110,  // Arbitrum One
            10: 30111,     // Optimism
            250: 30112,    // Fantom
            11155111: 40161, // Ethereum Sepolia
            97: 40102,   // BSC Testnet
        }
        
        const eid = chainIdToEid[chainId]
        if (!eid) {
            throw new Error(`Unsupported network with chainId ${chainId}`)
        }
        
        return eid
    }

    /**
     * Check if a token has an OFT adapter by looking for common patterns
     */
    async findOFTAdapterForToken(tokenAddress: string): Promise<string | null> {
        try {
            const signer = await this.getSigner()
            
            // Check if the token itself implements OFT functions
            const tokenContract = new ethers.Contract(tokenAddress, [
                'function quoteSend(tuple(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) external view returns (uint256 nativeFee, uint256 lzTokenFee)',
                'function send(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd, tuple(uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) external payable returns (bytes32 guid)'
            ], signer)
            
            // Try to call a simple view function to see if it's an OFT
            try {
                const testSendParam = {
                    dstEid: 30101,
                    to: '0x0000000000000000000000000000000000000000000000000000000000000000',
                    amountLD: '1000000',
                    minAmountLD: '1000000',
                    extraOptions: '0x',
                    composeMsg: '0x',
                    oftCmd: '0x'
                }
                await tokenContract.quoteSend(testSendParam, false)
                console.log('Token appears to be an OFT itself')
                return tokenAddress
            } catch (error) {
                console.log('Token is not an OFT, checking for adapters...')
            }
            
            // Check common OFT adapter patterns
            const network = await this.getChainId()
            const knownAdapters: Record<string, Record<number, string>> = {
                // USDC
                '0xA0b86a33E6441b8c4C8C8C8C8C8C8C8C8C8C8C8': {
                    1: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
                    56: '0x9aF3b7DC29D3C4A1D9eC55F6B2026655c43f4d4a',
                    137: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff'
                },
                // USDT
                '0xdAC17F958D2ee523a2206206994597C13D831ec7': {
                    1: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                    56: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                    137: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
                }
            }
            
            const adapterAddress = knownAdapters[tokenAddress.toLowerCase()]?.[network]
            if (adapterAddress) {
                return adapterAddress
            }
            
            return null
        } catch (error) {
            console.error('Error finding OFT adapter:', error)
            return null
        }
    }
} 