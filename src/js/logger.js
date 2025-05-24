function createLogger(options = {}) {
    const {
        logToConsole = true,
        logContent = null,
        statusDiv = null,
        prefix = ''
    } = options;

    return {
        message: function (text) {
            this._setStatus(text, 'green');
            this.debug(text);
        },
        error: function (text) {
            this._setStatus(text, 'red');
            this.debug(text);
        },
        debug: function (text) {
            const timestamp = new Date().toLocaleTimeString();
            const formattedMessage = `[${timestamp}] ${prefix}${text}`;

            if (logToConsole) {
                console.log(formattedMessage);
            }

            if (logContent) {
                logContent.textContent += `${formattedMessage}\n`;
                if (logContent.parentElement) {
                    logContent.parentElement.scrollTop = logContent.parentElement.scrollHeight;
                }
            }
        },
        _setStatus: function (text, color) {
            if (statusDiv) {
                statusDiv.textContent = text;
                statusDiv.style.color = color;
            }
        }
    };
}
