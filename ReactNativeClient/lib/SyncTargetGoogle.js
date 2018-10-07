const BaseSyncTarget = require('lib/BaseSyncTarget.js');
const { _ } = require('lib/locale.js');
const { GoogleApi } = require('lib/GoogleApi.js');
const Setting = require('lib/models/Setting.js');
const { parameters } = require('lib/parameters.js');
const { FileApi } = require('lib/file-api.js');
const { Synchronizer } = require('lib/synchronizer.js');
const { FileApiDriverGoogleDrive } = require('lib/file-api-driver-googledrive.js');

class SyncTargetGoogle extends BaseSyncTarget {

	static id() {
		return 8;
	}

	constructor(db, options = null) {
		super(db, options);
		this.api_ = null;
	}

	static targetName() {
		return 'google';
	}

	static label() {
		return _('Google');
	}

	async isAuthenticated() {
		return this.api().auth();
	}

	syncTargetId() {
		return SyncTargetGoogle.id();
	}

	googleParameters() {
		return parameters().google;
	}

	authRouteName() {
		return 'GoogleLogin';
	}

	api() {
		if (this.api_) return this.api_;

		this.api_ = new GoogleApi(this.googleParameters().id);
		this.api_.setLogger(this.logger());

		this.api_.on('authRefreshed', (a) => {
			this.logger().info('Saving updated Google auth.');
			Setting.setValue('sync.' + this.syncTargetId() + '.auth', a ? JSON.stringify(a) : null);
		});

		let auth = Setting.value('sync.' + this.syncTargetId() + '.auth');
		if (auth) {
			try {
				auth = JSON.parse(auth);
			} catch (error) {
				this.logger().warn('Could not parse Google auth token');
				this.logger().warn(error);
				auth = null;
			}

			this.api_.setAuth(auth);
		}
		
		return this.api_;
	}

	async initFileApi() {
		const appDir = '';
		const fileApi = new FileApi(appDir, new FileApiDriverGoogleDrive(this.api()));
		fileApi.setSyncTargetId(this.syncTargetId());
		fileApi.setLogger(this.logger());
		return fileApi;
	}

	async initSynchronizer() {
		if (!await this.isAuthenticated()) throw new Error('User is not authentified');
		return new Synchronizer(this.db(), await this.initFileApi(), Setting.value('appType'));
	}

}

module.exports = SyncTargetGoogle;