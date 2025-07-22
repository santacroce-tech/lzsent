import { useState, useEffect, useCallback } from 'react'
import { OFTClient, isMetaMaskInstalled, getMetaMaskProvider, requestMetaMaskAccounts } from '../lib'

export interface UseOFTClientReturn {
    client: OFTClient | null
    isConnected: boolean
    loading: boolean
    error: string | null
    address: string | null
    chainId: number | null
    connect: () => Promise<void>
    disconnect: () => void
}

export function useOFTClient(): UseOFTClientReturn {
    const [client, setClient] = useState<OFTClient | null>(null)
    const [isConnected, setIsConnected] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [address, setAddress] = useState<string | null>(null)
    const [chainId, setChainId] = useState<number | null>(null)

    const connect = useCallback(async () => {
        setLoading(true)
        setError(null)
        
        try {
            // Check if MetaMask is installed
            if (!isMetaMaskInstalled()) {
                throw new Error('MetaMask is not installed. Please install MetaMask extension.')
            }

            // Get MetaMask provider
            const provider = getMetaMaskProvider()

            // Request account access
            const accounts = await requestMetaMaskAccounts()
            if (accounts.length === 0) {
                throw new Error('No accounts found. Please connect MetaMask.')
            }

            // Create OFT client
            const oftClient = new OFTClient(provider)
            
            // Get current address and chain ID
            const currentAddress = await oftClient.getSignerAddress()
            const currentChainId = await oftClient.getChainId()

            setClient(oftClient)
            setIsConnected(true)
            setAddress(currentAddress)
            setChainId(currentChainId)

            console.log('Connected to MetaMask:', currentAddress)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to connect'
            setError(errorMessage)
            console.error('Failed to initialize OFT client:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    const disconnect = useCallback(() => {
        setClient(null)
        setIsConnected(false)
        setAddress(null)
        setChainId(null)
        setError(null)
    }, [])

    // Listen for account changes
    useEffect(() => {
        if (!isConnected) return

        const handleAccountsChanged = (accounts: unknown) => {
            const accountArray = accounts as string[]
            if (accountArray.length === 0) {
                disconnect()
            } else {
                setAddress(accountArray[0])
            }
        }

        const handleChainChanged = () => {
            // Reload the page when chain changes
            window.location.reload()
        }

        const provider = getMetaMaskProvider()
        provider.on('accountsChanged', handleAccountsChanged)
        provider.on('chainChanged', handleChainChanged)

        return () => {
            provider.removeListener('accountsChanged', handleAccountsChanged)
            provider.removeListener('chainChanged', handleChainChanged)
        }
    }, [isConnected, disconnect])

    return {
        client,
        isConnected,
        loading,
        error,
        address,
        chainId,
        connect,
        disconnect
    }
} 