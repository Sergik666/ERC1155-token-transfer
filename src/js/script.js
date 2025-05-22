const connectButton = document.getElementById('connectButton');
const getBalanceButton = document.getElementById('getBalanceButton');
const transferButton = document.getElementById('transferButton');
const statusDiv = document.getElementById('status');
const walletAddressDiv = document.getElementById('walletAddress');
const contractAddressInput = document.getElementById('contractAddress');
const balancesDiv = document.getElementById('balances');
const recipientAddressInput = document.getElementById('recipientAddress');
const transferStatusDiv = document.getElementById('transferStatus');
const logContent = document.getElementById('logContent');

const POLYGON_CHAIN_ID = '0x89'; // 137 в hex
const POLYGON_RPC_URL = 'https://polygon-rpc.com/';
const POLYGON_EXPLORER = 'https://polygonscan.com/';
const ID_FETCH_LIMIT = 2000;
const METADATA_FETCH_TIMEOUT = 10000;

let provider;
let signer;
let userAddress;
let currentContractAddress;
let currentBalances = {}; // { idString: balanceString }

const erc1155Abi = [
    "function balanceOfBatch(address[] memory accounts, uint256[] memory ids) public view returns (uint256[] memory)",
    "function safeBatchTransferFrom(address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data) public",
    "function uri(uint256 _id) public view returns (string memory)"
];

function logMessage(message) {
    console.log(message);
    const timestamp = new Date().toLocaleTimeString();
    logContent.textContent += `[${timestamp}] ${message}\n`;
    logContent.parentElement.scrollTop = logContent.parentElement.scrollHeight;
}

async function connectWallet() {
    logMessage('Попытка подключения кошелька...');
    if (typeof window.ethereum === 'undefined') {
        logMessage('Ошибка: MetaMask не установлен!');
        statusDiv.textContent = 'Ошибка: MetaMask не установлен!';
        alert('Пожалуйста, установите MetaMask!');
        return;
    }
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];
        logMessage(`Кошелек подключен: ${userAddress}`);
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        await switchToPolygon();
        statusDiv.textContent = 'Статус: Подключен к Polygon';
        statusDiv.style.color = 'green';
        walletAddressDiv.textContent = `Адрес кошелька: ${userAddress}`;
        connectButton.textContent = 'Кошелек подключен';
        connectButton.disabled = true;
        getBalanceButton.disabled = false;
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);
    } catch (error) {
        logMessage(`Ошибка подключения: ${error.message || error}`);
        statusDiv.textContent = `Ошибка подключения: ${error.message || error}`;
        statusDiv.style.color = 'red';
    }
}

async function switchToPolygon() {
    logMessage('Проверка сети...');
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== POLYGON_CHAIN_ID) {
        logMessage(`Требуется переключение на Polygon (${POLYGON_CHAIN_ID})`);
        statusDiv.textContent = 'Требуется переключение на Polygon...';
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_CHAIN_ID }], });
            logMessage('Успешно переключено на Polygon.');
            statusDiv.textContent = 'Статус: Подключен к Polygon';
        } catch (switchError) {
            if (switchError.code === 4902) {
                logMessage('Сеть Polygon не найдена, попытка добавить...');
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{ chainId: POLYGON_CHAIN_ID, chainName: 'Polygon Mainnet', rpcUrls: [POLYGON_RPC_URL], nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18, }, blockExplorerUrls: [POLYGON_EXPLORER], }],
                    });
                    logMessage('Сеть Polygon добавлена. Повторная попытка переключения...');
                    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_CHAIN_ID }], });
                    logMessage('Успешно переключено на Polygon.');
                    statusDiv.textContent = 'Статус: Подключен к Polygon';
                } catch (addError) {
                    logMessage(`Ошибка добавления/переключения сети Polygon: ${addError.message || addError}`);
                    statusDiv.textContent = `Ошибка сети: ${addError.message || addError}`;
                    throw addError;
                }
            } else {
                logMessage(`Ошибка переключения сети: ${switchError.message || switchError}`);
                statusDiv.textContent = `Ошибка переключения сети: ${switchError.message || switchError}`;
                throw switchError;
            }
        }
    } else {
        logMessage('Уже подключены к сети Polygon.');
    }
}

function handleAccountsChanged(accounts) {
    if (accounts.length === 0) { logMessage('Кошелек отключен.'); resetApp(); }
    else {
        userAddress = accounts[0]; logMessage(`Аккаунт изменен: ${userAddress}`);
        walletAddressDiv.textContent = `Адрес кошелька: ${userAddress}`;
        signer = provider.getSigner(); resetBalancesAndTransfer();
        if (currentContractAddress) { getBalances(); }
    }
}
function handleChainChanged(chainId) {
    logMessage(`Сеть изменена: ${chainId}`);
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();
    if (chainId !== POLYGON_CHAIN_ID) {
        logMessage('Предупреждение: Выбрана неверная сеть.'); statusDiv.textContent = 'Статус: Подключена неверная сеть!'; statusDiv.style.color = 'orange';
        resetBalancesAndTransfer(); getBalanceButton.disabled = true;
    } else {
        logMessage('Подключено к сети Polygon.'); statusDiv.textContent = 'Статус: Подключен к Polygon'; statusDiv.style.color = 'green';
        getBalanceButton.disabled = !userAddress;
        if (currentContractAddress && userAddress) { getBalances(); }
    }
}
function resetApp() {
    statusDiv.textContent = 'Статус: Не подключен'; statusDiv.style.color = 'black';
    walletAddressDiv.textContent = 'Адрес кошелька: -';
    connectButton.textContent = 'Подключить MetaMask'; connectButton.disabled = false;
    getBalanceButton.disabled = true; transferButton.disabled = true;
    contractAddressInput.value = ''; recipientAddressInput.value = '';
    currentContractAddress = null; userAddress = null; provider = null; signer = null;
    resetBalancesAndTransfer(); logContent.textContent = '';
}

function resetBalancesAndTransfer() {
    balancesDiv.innerHTML = 'Нет данных';
    transferStatusDiv.textContent = '';
    currentBalances = {};
    transferButton.disabled = true;
}

function resolveMetadataUri(uri, tokenId) {
    if (!uri) return null;

    if (uri.includes('{id}')) {
        const hexId = ethers.BigNumber.from(tokenId).toHexString().substring(2).padStart(64, '0');
        uri = uri.replace('{id}', hexId);
    }

    if (uri.startsWith('ipfs://')) {
        return `https://ipfs.io/ipfs/${uri.substring(7)}`;
    }

    return uri;
}

function resetBalancesAndTransfer() {
    balancesDiv.innerHTML = 'Нет данных';
    transferStatusDiv.textContent = '';
    currentBalances = {};
    transferButton.disabled = true;
}

async function getBalances() {
    currentContractAddress = contractAddressInput.value.trim();
    if (!ethers.utils.isAddress(currentContractAddress)) { /*...*/ return; }
    if (!provider || !userAddress) { /*...*/ return; }

    logMessage(`Запрос балансов для контракта ${currentContractAddress}...`);
    balancesDiv.innerHTML = '<i>Загрузка балансов...</i>';
    getBalanceButton.disabled = true;
    resetBalancesAndTransfer(); 

    try {
        const contract = new ethers.Contract(currentContractAddress, erc1155Abi, provider);
        const idsToCheck = [];
        const accounts = [];
        for (let i = 0; i <= ID_FETCH_LIMIT + 0; i++) {
            idsToCheck.push(ethers.BigNumber.from(i));
            accounts.push(userAddress);
        }

        logMessage(`Вызов balanceOfBatch для ID 0-${ID_FETCH_LIMIT}...`);
        const balancesBigNum = await contract.balanceOfBatch(accounts, idsToCheck);
        logMessage('Балансы получены. Запрос метаданных...');

        const tokensWithBalance = [];
        balancesBigNum.forEach((balance, index) => {
            if (!balance.isZero()) {
                tokensWithBalance.push({ id: idsToCheck[index], balance: balance });
            }
        });

        if (tokensWithBalance.length === 0) {
            balancesDiv.innerHTML = `Нет токенов с балансом > 0 в диапазоне ID 0-${ID_FETCH_LIMIT}.`;
            logMessage(`Нет токенов с балансом > 0 в диапазоне ID 0-${ID_FETCH_LIMIT}.`);
            return;
        }

        balancesDiv.innerHTML = `<i>Загрузка метаданных (${tokensWithBalance.length} токенов)...</i>`;

        const metadataPromises = tokensWithBalance.map(async (token) => {
            const tokenId = token.id;
            const balance = token.balance;
            let name = `Token ID: ${tokenId.toString()}`;
            let imageUrl = null;
            let decimals = 0;
            let metadataError = null;

            try {
                const rawUri = await contract.uri(tokenId);
                const resolvedUri = resolveMetadataUri(rawUri, tokenId);

                if (resolvedUri) {
                    logMessage(`[ID: ${tokenId}] Запрос метаданных с ${resolvedUri}`);
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT);

                    try {
                        const response = await fetch(resolvedUri, { signal: controller.signal });
                        clearTimeout(timeoutId);

                        if (!response.ok) throw new Error(`HTTP ${response.status}`);

                        const metadata = await response.json();
                        name = metadata.name || name;
                        imageUrl = metadata.image || metadata.image_url || metadata.imageUrl || null;
                        if (imageUrl && imageUrl.startsWith('ipfs://')) {
                            imageUrl = `https://ipfs.io/ipfs/${imageUrl.substring(7)}`;
                        }

                        if (metadata.decimals !== undefined && Number.isInteger(metadata.decimals) && metadata.decimals >= 0) {
                            decimals = metadata.decimals;
                            logMessage(`[ID: ${tokenId}] Обнаружены decimals: ${decimals}`);
                        } else {
                            logMessage(`[ID: ${tokenId}] Decimals не найдены или некорректны в метаданных, используется 0.`);
                        }

                        logMessage(`[ID: ${tokenId}] Метаданные получены: Имя='${name}', Decimals=${decimals}`);

                    } catch (fetchError) {
                        clearTimeout(timeoutId);
                        metadataError = fetchError.message || 'Ошибка сети/CORS/JSON/Таймаут';
                        logMessage(`[ID: ${tokenId}] Ошибка fetch: ${metadataError}`);
                    }
                } else {
                    metadataError = 'URI отсутствует/невалиден';
                    logMessage(`[ID: ${tokenId}] URI метаданных отсутствует.`);
                }
            } catch (error) {
                metadataError = error.message || 'Ошибка контракта/URI';
                logMessage(`[ID: ${tokenId}] Ошибка получения URI: ${metadataError}`);
            }

            return {
                id: tokenId,
                rawBalance: balance,
                name: name,
                imageUrl: imageUrl,
                decimals: decimals,
                error: metadataError
            };
        });

        const metadataResults = await Promise.allSettled(metadataPromises);

        currentBalances = {};
        const balanceList = document.createElement('ul');
        let displayedCount = 0;

        metadataResults.forEach(result => {
            if (result.status === 'fulfilled') {
                const data = result.value;
                const idStr = data.id.toString();
                const rawBalanceStr = data.rawBalance.toString();
                const decimals = data.decimals;

                currentBalances[idStr] = {
                    rawBalance: rawBalanceStr,
                    decimals: decimals,
                    name: data.name
                };
                displayedCount++;

                const listItem = document.createElement('li');

                const imageDiv = document.createElement('div');
                imageDiv.classList.add('token-image');
                if (data.imageUrl) {
                    const img = document.createElement('img');
                    img.src = data.imageUrl;
                    img.alt = data.name;
                    img.onerror = () => { imageDiv.innerHTML = '[Ошибка загр.]'; };
                    imageDiv.appendChild(img);
                } else { imageDiv.textContent = '[Нет изобр.]'; }

                const infoDiv = document.createElement('div');
                infoDiv.classList.add('token-info');

                let formattedBalance = '';
                try {
                    formattedBalance = ethers.utils.formatUnits(data.rawBalance, decimals);
                    if (decimals === 0 && formattedBalance.endsWith('.0')) {
                        formattedBalance = formattedBalance.slice(0, -2);
                    } else if (decimals > 0 && formattedBalance.includes('.') && formattedBalance.endsWith('0')) {
                        formattedBalance = parseFloat(formattedBalance).toString();
                    }
                } catch (formatError) {
                    logMessage(`[ID: ${idStr}] Ошибка форматирования баланса: ${formatError.message}`);
                    formattedBalance = 'Ошибка!';
                }


                infoDiv.innerHTML = `
                         <strong>${data.name}</strong>
                         <small>ID: ${idStr}</small>
                         <div class="balance-line">Баланс: <span class="balance-amount">${formattedBalance}</span></div>
                         <div class="raw-balance-line">Базовых единиц: ${rawBalanceStr}</div>
                         ${data.error ? `<span class="metadata-error">Ошибка метаданных: ${data.error}</span>` : ''}
                     `;

                const transferDiv = document.createElement('div');
                transferDiv.classList.add('token-transfer');
                const amountInput = document.createElement('input');
                amountInput.type = 'number';
                amountInput.max = formattedBalance;
                amountInput.step = 'any';
                amountInput.placeholder = 'Кол-во';
                amountInput.dataset.tokenId = idStr;
                transferDiv.appendChild(amountInput);

                listItem.appendChild(imageDiv);
                listItem.appendChild(infoDiv);
                listItem.appendChild(transferDiv);
                balanceList.appendChild(listItem);

            } else { 
                logMessage(`Критическая ошибка обработки промиса метаданных: ${result.reason}`);
            }
        });

        if (displayedCount > 0) {
            balancesDiv.innerHTML = '';
            balancesDiv.appendChild(balanceList);
            transferButton.disabled = false;
            logMessage(`Отображены балансы и метаданные для ${displayedCount} токенов.`);
        } else {
            balancesDiv.innerHTML = 'Не удалось получить метаданные ни для одного токена.';
            logMessage('Не удалось получить метаданные ни для одного токена.');
            transferButton.disabled = true;
        }

    } catch (error) {
        logMessage(`Критическая ошибка при получении балансов: ${error.message || error}`);
        balancesDiv.innerHTML = `Ошибка получения балансов: ${error.message || error}`;
        transferButton.disabled = true;
    } finally {
        getBalanceButton.disabled = false;
    }
}

async function transferTokens() {
    const recipientAddress = recipientAddressInput.value.trim();
    if (!ethers.utils.isAddress(recipientAddress)) { /*...*/ return; }
    if (!signer || !userAddress || !currentContractAddress) { /*...*/ return; }

    const idsToTransfer = [];
    const amountsToTransfer = [];
    let inputError = false;
    let conversionError = false;

    const amountInputs = balancesDiv.querySelectorAll('input[type="number"][data-token-id]');

    amountInputs.forEach(input => {
        const idStr = input.dataset.tokenId;
        const amountStr = input.value.trim();
        input.style.borderColor = '';

        if (amountStr && parseFloat(amountStr) > 0) {
            const tokenData = currentBalances[idStr]; 
            if (!tokenData) {
                logMessage(`[Transfer Error] Не найдены данные для ID ${idStr} в currentBalances.`);
                inputError = true;
                input.style.borderColor = 'red';
                return;
            }

            const { rawBalance: rawBalanceStr, decimals } = tokenData;
            const rawBalanceBigNum = ethers.BigNumber.from(rawBalanceStr);

            try {
                const rawAmountToSend = ethers.utils.parseUnits(amountStr, decimals);

                if (rawAmountToSend.isNegative() || rawAmountToSend.isZero()) {
                    throw new Error("Количество должно быть положительным.");
                }
                if (rawAmountToSend.gt(rawBalanceBigNum)) {
                    throw new Error(`Превышает баланс (${ethers.utils.formatUnits(rawBalanceBigNum, decimals)})`);
                }

                idsToTransfer.push(idStr);
                amountsToTransfer.push(rawAmountToSend);

            } catch (e) {
                logMessage(`[ID: ${idStr}] Ошибка ввода/валидации: ${e.message} (Введено: "${amountStr}")`);
                input.style.borderColor = 'red';
                inputError = true;
                if (e.message.includes('underflow') || e.message.includes('invalid decimal value')) {
                    conversionError = true;
                }
            }
        } else if (amountStr && parseFloat(amountStr) <= 0) {
            input.style.borderColor = 'red';
            logMessage(`[ID: ${idStr}] Количество должно быть положительным.`);
            inputError = true;
        }
    });

    if (inputError) {
        let alertMessage = 'Пожалуйста, исправьте ошибки в полях количества (отмечены красным).';
        if (conversionError) {
            alertMessage += '\nУбедитесь, что количество десятичных знаков не превышает допустимое для токена.';
        }
        alert(alertMessage);
        return;
    }

    if (idsToTransfer.length === 0) {
        logMessage('Нет токенов для перевода.');
        alert('Пожалуйста, укажите количество > 0 хотя бы для одного токена.');
        return;
    }

    logMessage(`Подготовка к переводу ${idsToTransfer.length} типов токенов на адрес ${recipientAddress}...`);
    logMessage(`IDs: [${idsToTransfer.join(', ')}]`);
    logMessage(`Raw Amounts: [${amountsToTransfer.map(a => a.toString()).join(', ')}]`);
    transferButton.disabled = true;
    transferStatusDiv.textContent = 'Подтвердите транзакцию в MetaMask...';

    try {
        const contract = new ethers.Contract(currentContractAddress, erc1155Abi, signer);
        const tx = await contract.safeBatchTransferFrom(
            userAddress, recipientAddress, idsToTransfer, amountsToTransfer, '0x'
        );
        logMessage(`Транзакция отправлена! Хэш: ${tx.hash}`);
        transferStatusDiv.textContent = `Транзакция отправлена! Ожидание подтверждения...`;
        const receipt = await tx.wait();
        logMessage(`Транзакция подтверждена! Блок: ${receipt.blockNumber}`);
        transferStatusDiv.innerHTML = `Успешно! <a href="${POLYGON_EXPLORER}tx/${tx.hash}" target="_blank">PolygonScan</a>`;
        amountInputs.forEach(input => input.value = ''); // Очистка инпутов
        logMessage('Обновление балансов после перевода...');
        await getBalances();

    } catch (error) {
        logMessage(`Ошибка перевода: ${error.message || error}`);
        transferStatusDiv.textContent = `Ошибка перевода: ${error.message || error}`;
        transferButton.disabled = Object.keys(currentBalances).length === 0;
    }
}

window.addEventListener('load', () => {
    logMessage('Страница загружена. Ожидание подключения кошелька.');
    connectButton.addEventListener('click', connectWallet);
    getBalanceButton.addEventListener('click', getBalances);
    transferButton.addEventListener('click', transferTokens);
});
