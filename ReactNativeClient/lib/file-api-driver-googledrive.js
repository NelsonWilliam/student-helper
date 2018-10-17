const moment = require('moment');
const { time } = require('lib/time-utils.js');
const { dirname, basename } = require('lib/path-utils.js');
const { basicDelta } = require('lib/file-api');

class FileApiDriverGoogleDrive {

	constructor(api) {
		this.api_ = api;
		this.pathCache_ = {};
	}

	api() {
		return this.api_;
	}

	//----------------------------------------
	// MÉTODOS AUXILIARES
	//----------------------------------------

	folderMimeType_() {
		return "application/vnd.google-apps.folder";
	}

	async createFile_(parentId, name, mimeType) {
		const query = {}
		const body = {
			name: name,
			mimeType: mimeType,
			parents: [parentId],
		}
		const result = await this.api_.execJson("POST", "https://www.googleapis.com/drive/v3/files", query, body);
		return result;
	}

	async updateFile_(parentId, fileId, name, mimeType) {
		const query = {}
		const body = {
			name: name,
			mimeType: mimeType,
			parents: [parentId],
		}
		const result = await this.api_.execJson("PATCH", "https://www.googleapis.com/drive/v3/files/" + fileId, query, body);
		return result;
	}

	/**
	 * @returns Metadados do arquivo encontrado (ou null caso não tenha encontrado).
	 */
	async getChildFile_(parentId, childName, childMimeType, createIfDoesntExists = false) {
		let result = null;
		let q = `'${parentId}' in parents`;
		if (childName) q += ` and name = '${childName}'`;
		if (childMimeType) q += ` and mimeType = '${childMimeType}'`;
		const listResult = await this.listFiles_(q);
		if (listResult && listResult.files && listResult.files[0]) {
			result = listResult.files[0];
		}
		if (result === null && createIfDoesntExists) {
			result = await this.createFile_(parentId, childName, childMimeType);
		}
		return result;
	}

	/**
	 * Obtém os metadados do arquivo com o ID especificado.
	 */
	async getFile_(fileId) {
		const result = await this.api_.execJson("GET", "https://www.googleapis.com/drive/v3/files/" + fileId, {}, {});
		return result;
	}

	/**
	 * Remove um arquivo com o ID especificado.
	 */
	async deleteFile_(fileId) {
		const result = await this.api_.execJson("DELETE", "https://www.googleapis.com/drive/v3/files/" + fileId, {}, {});
		return result;
	}

	/**
	 * Obtém (e cria, se necessário) a pasta raiz do aplicativo.
	 *
	 * NOTE: Atualmente é uma pasta chamada "Joplin" na raiz do Google Drive. No
	 * futuro, quando formos usar o appData, altere isso para a pasta
	 * appDataFolder.
	 */
	async getRootFolder_() {
		const rootId = "root";
		return await this.getChildFile_(rootId, "Joplin", this.folderMimeType_(), true);
		// NOTE: Depois deve mudar isso para:
		// return await this.getFileRaw_("appDataFolder");
	}

	/**
	 * Busca por arquivos com os parâmetros definidos.
	 * @param {*} q Parâmetros de busca. Leia sobre em "https://developers.google.com/drive/api/v3/search-parameters".
	 */
	async listFiles_(q, additionalParams = {}) {
		const baseParams = {
			spaces: "drive", // NOTE: Depois deve mudar isso pra "appDataFolder"
			q: q,
		};
		const params = Object.assign(baseParams, additionalParams);
		const result = await this.api_.execJson("GET", "https://www.googleapis.com/drive/v3/files", params);
		return result;
	}

	fileToStat_(metadata, path) {
		let output = {
			path: path,
			isDir: metadata.mimeType = this.folderMimeType_(),
			updated_time: metadata.modifiedTime ? new Date(md.modifiedTime) : new Date(),
			isDeleted: metadata.trashed ? metadata.trashed : false,
		}
		return output;
	}

	async pathToFileId_(path, createIfDoesntExists = true) {
		if (!path) return null;
		const pathParts = path.split("/|\"");
		const rootFolder = await this.getRootFolder_();
		let currentId = rootFolder.id;
		for (let i = 0; i < pathParts.length; i++) {
			const fileName = pathParts[i];
			// Assume que é uma pasta sempre que não for o último no path ou não tiver extensão
			const isFolder = i <= pathParts.length - 1 || fileName.search("^.+\.[^.\\/]+$") == -1;
			if (isFolder) {
				const folder = await this.getChildFile_(currentId, fileName, this.folderMimeType_(), createIfDoesntExists);
				if (!folder) return null;
				currentId = folder.id;
			} else {
				const file = await this.getChildFile_(currentId, fileName, null, createIfDoesntExists);
				if (!file) return null;
				currentId = file.id;
			}
		}
		return currentId;
	}

	//----------------------------------------
	// MÉTODOS QUE O DRIVER DEVE IMPLEMENTAR
	//----------------------------------------

	async stat(path) { // CONCLUÍDO
		try {
			let item = await this.getFile_(path);
			return this.fileToStat_(item);
		} catch (error) {
			if (error.code == 404) {
				// ignore
			} else {
				throw error;
			}
		}
	}

	async list(path, options = null) { // CONCLUÍDO
		if (!options) options = {};

		const folderId = await this.pathToFileId_(path, false);
		if (!folderId) {
			return {
				hasMore: false,
				items: [],
				context: undefined,
			}
		}

		const additionalParams = {};
		if (options.context) {
			additionalParams.pageToken = options.context;
		}

		let query = `${folderId} in parents`;
		let result = await this.listFiles_(query, additionalParams);
		let items = [];
		if (result.files && result.files.length > 0) {
			for (let i = 0; i < result.files.length; i++) {
				const file = result.files[i];
				const stat = this.fileToStat_(file, path);
				items.push(stat);
			}
		}

		return {
			hasMore: !!result['nextPageToken'],
			items: items,
			context: result["nextPageToken"],
		}
	}

	async mkdir(path) { // CONCLUÍDO
		if (!path) return;
		return await this.pathToFileId_(path, true);
	}

	async delta(path, options) { // CONCLUÍDO
		const getDirStats = async (path) => {
			const result = await this.list(path);
			return result.items;
		};

		return await basicDelta(path, getDirStats, options);
	}

	async setTimestamp(path, timestamp) {
		const fileId = await this.pathToFileId_(path, false);
		throw new Error('Not implemented');
	}

	async get(path, options = null) {
		if (!options) options = {};
	
		const fileId = await this.pathToFileId_(path, false);
		if (!fileId) {
			throw error;
		}
	
		let result = await this.getFile_(fileId);
		return {
			result: result
		}

	}

	async put(path, content, options = null, parentId, childName, childMimeType) {
		const fileId = await this.pathToFileId_(path, false);
		let result = await this.updateFile_(parentId, fileId, childName, childMimeType);
		return {
			result: result
		}
	}

	async delete(path) {
		const fileId = await this.pathToFileId_(path, false);
		let result = await this.deleteFile_(fileId);
		return {
			result: result
		}
	}

	async move(oldPath, newPath) {
		throw new Error('Not implemented');

		/*// Cannot work in an atomic way because if newPath already exist, the OneDrive API throw an error
		// "An item with the same name already exists under the parent". Some posts suggest to use
		// @name.conflictBehavior [0]but that doesn't seem to work. So until Microsoft fixes this
		// it's not possible to do an atomic move.
		//
		// [0] https://stackoverflow.com/questions/29191091/onedrive-api-overwrite-on-move
		throw new Error('NOT WORKING');

		let previousItem = await this.statRaw_(oldPath);

		let newDir = dirname(newPath);
		let newName = basename(newPath);

		// We don't want the modification date to change when we move the file so retrieve it
		// now set it in the PATCH operation.		

		let item = await this.api_.execJson('PATCH', this.makePath_(oldPath), this.itemFilter_(), {
			name: newName,
			parentReference: { path: newDir },
			fileSystemInfo: {
				lastModifiedDateTime: previousItem.fileSystemInfo.lastModifiedDateTime,
			},
		});

		return this.makeItem_(item);*/
	}

	format() { // ACHO QUE NÃO PRECISA FAZER ESSE
		throw new Error('Not implemented');
	}

	clearRoot() { // ACHO QUE NÃO PRECISA FAZER ESSE
		throw new Error('Not implemented');
	}

}

module.exports = { FileApiDriverGoogleDrive };