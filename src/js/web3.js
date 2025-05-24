async function connectWeb3Wallet(logger) {
    logger.debug(t('Attempting to connect wallet...'));
    
    if (typeof window.ethereum === 'undefined') {
        logger.error(t('Error: Web3 wallet is not installed!'));
        return null;
    }
    
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];
        logger.debug(t('Wallet connected:') + ` ${userAddress}`);
        provider = new ethers.providers.Web3Provider(window.ethereum);
        return provider.getSigner();
    } catch (error) {
        logger.error(t('Connection error:') + ` ${error.message || error}`);
        return null;
    }
}