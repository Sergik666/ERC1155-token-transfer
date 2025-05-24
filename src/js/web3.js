async function connectWeb3Wallet(logger) {
    logger.debug('Попытка подключения кошелька...');
    if (typeof window.ethereum === 'undefined') {
        logger.error('Ошибка: Web 3 кошелька не установлен!');
        return null;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];
        logger.debug(`Кошелек подключен: ${userAddress}`);
        provider = new ethers.providers.Web3Provider(window.ethereum);
        return provider.getSigner();
    } catch (error) {
        logger.error(`Ошибка подключения: ${error.message || error}`);
        return null;
    }
}
