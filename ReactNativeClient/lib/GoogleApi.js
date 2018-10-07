const { shim } = require('lib/shim.js');
const { stringify } = require('query-string');
const { time } = require('lib/time-utils.js');
const { Logger } = require('lib/logger.js');

/** 
 * Class that allows to authenticate with a Google Account and run Google API
 * queries using the 'exec' methods.
 */
class GoogleApi {

    constructor(clientId) {
        this.clientId_ = clientId;
        this.auth_ = null;
        this.logger_ = new Logger();
        this.listeners_ = {
            'authRefreshed': [],
        };
    }

    setLogger(l) {
        this.logger_ = l;
    }

    logger() {
        return this.logger_;
    }

    dispatch(eventName, param) {
        let ls = this.listeners_[eventName];
        for (let i = 0; i < ls.length; i++) {
            ls[i](param);
        }
    }

    on(eventName, callback) {
        this.listeners_[eventName].push(callback);
    }

    auth() {
        return this.auth_;
    }

    setAuth(auth) {
        this.auth_ = auth;
        this.dispatch('authRefreshed', this.auth());
    }

    token() {
        return this.auth_ ? this.auth_.access_token : null;
    }

    clientId() {
        return this.clientId_;
    }

    authBaseUrl() {
        return 'https://accounts.google.com/o/oauth2/v2/auth';
    }

    tokenBaseUrl() {
        return 'https://www.googleapis.com/oauth2/v4/token';
    }

    redirectUri() {
        // This isn't used by anything, since we get the auth response from
        // events that can be catched when the browser window finishes the
        // authentication and redirects to this. This value is used to avoid
        // errors.
        return "http://localhost";
    }

    authCodeUrl() {
        let query = {
            client_id: this.clientId(),
            redirect_uri: this.redirectUri(),
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar',
        };
        return this.authBaseUrl() + '?' + stringify(query);
    }

    async execTokenRequest(code) {
        let body = new shim.FormData();
        body.append('client_id', this.clientId());
        body.append('redirect_uri', this.redirectUri());
        body.append('code', code);
        body.append('grant_type', 'authorization_code');

        const r = await shim.fetch(this.tokenBaseUrl(), {
            method: 'POST',
            body: body,
        })

        if (!r.ok) {
            const text = await r.text();
            throw new Error('Could not retrieve auth code: ' + r.status + ': ' + r.statusText + ': ' + text);
        }

        try {
            const json = await r.json();
            this.setAuth(json);

        } catch (error) {
            this.setAuth(null);
            const text = await r.text();
            error.message += ': ' + text;
            throw error;
        }
    }

    async refreshAccessToken() {
        if (!this.auth_ || !this.auth_.refresh_token) {
            this.setAuth(null);
            throw new Error(_('Cannot refresh token: authentication data is missing. Starting the synchronisation again may fix the problem.'));
        }

        let body = new shim.FormData();
        body.append('client_id', this.clientId());
        body.append('redirect_uri', this.redirectUri());
        body.append('refresh_token', this.auth_.refresh_token);
        body.append('grant_type', 'refresh_token');

        let options = {
            method: 'POST',
            body: body,
        };

        let response = await shim.fetch(this.tokenBaseUrl(), options);
        if (!response.ok) {
            this.setAuth(null);
            let msg = await response.text();
            throw new Error(msg + ': TOKEN: ' + this.auth_);
        }

        let auth = await response.json();
        this.setAuth(auth);
    }
    
    googleErrorResponseToError(errorResponse) {
        if (!errorResponse) return new Error('Undefined error');

        if (errorResponse.error) {
            let e = errorResponse.error;
            let output = new Error(e.message);
            if (e.code) output.code = e.code;
            if (e.innerError) output.innerError = e.innerError;
            return output;
        } else {
            return new Error(JSON.stringify(errorResponse));
        }
    }

    /**
     * Executes an API query and returns the result.
     * 
     * Example: exec('GET', 'https://www.googleapis.com/drive/v3/files', { orderBy: 'modifiedTime' })
     */
    async exec(method, path, query = null, data = null, options = null) {
        if (!path) throw new Error('Path is required');

        method = method.toUpperCase();

        if (!options) options = {};
        if (!options.headers) options.headers = {};
        if (!options.target) options.target = 'string';

        if (method != 'GET') {
            options.method = method;
        }

        if (method == 'PATCH' || method == 'POST') {
            options.headers['Content-Type'] = 'application/json';
            if (data) data = JSON.stringify(data);
        }

        let url = path;

        if (query) {
            url += url.indexOf('?') < 0 ? '?' : '&';
            url += stringify(query);
        }

        if (data) options.body = data;

        options.timeout = 1000 * 60 * 5; // in ms

        for (let i = 0; i < 5; i++) {
            options.headers['Authorization'] = 'Bearer ' + this.token();

            let response = null;
            try {
                if (options.source == 'file' && (method == 'POST' || method == 'PUT')) {
                    response = await shim.uploadBlob(url, options);
                } else if (options.target == 'string') {
                    response = await shim.fetch(url, options);
                } else { // file
                    response = await shim.fetchBlob(url, options);
                }
            } catch (error) {
                this.logger().error('Got unhandled error:', error ? error.code : '', error ? error.message : '', error);
                throw error;
            }

            if (!response.ok) {
                let errorResponseText = await response.text();
                let errorResponse = null;
                try {
                    errorResponse = JSON.parse(errorResponseText);//await response.json();
                } catch (error) {
                    error.message = 'Google API: Cannot parse JSON error: ' + errorResponseText + " " + error.message;
                    throw error;
                }

                let error = this.googleErrorResponseToError(errorResponse);

                if (error.code == 'InvalidAuthenticationToken' || error.code == 'unauthenticated') {
                    this.logger().info('Token expired: refreshing...');
                    await this.refreshAccessToken();
                    continue;

                } else if (error.code == 'itemNotFound' && method == 'DELETE') {
                    return;

                } else {
                    error.request = method + ' ' + url + ' ' + JSON.stringify(query) + ' ' + JSON.stringify(data) + ' ' + JSON.stringify(options);
                    error.headers = await response.headers;
                    throw error;
                }
            }

            return response;
        }

        throw new Error('Could not execute request after multiple attempts: ' + method + ' ' + url);
    }

    /**
     * Executes an API query and returns the parsed JSON result.
     */
    async execJson(method, path, query, data) {
        let response = await this.exec(method, path, query, data);
        let errorResponseText = await response.text();
        try {
            let output = JSON.parse(errorResponseText); //await response.json();
            return output;
        } catch (error) {
            error.message = 'Google API: Cannot parse JSON: ' + errorResponseText + " " + error.message;
            throw error;
            //throw new Error('Cannot parse JSON: ' + text);
        }
    }

    /**
     * Executes an API query and returns the result as plain text.
     */
    async execText(method, path, query, data) {
        let response = await this.exec(method, path, query, data);
        let output = await response.text();
        return output;
    }

}

module.exports = { GoogleApi };