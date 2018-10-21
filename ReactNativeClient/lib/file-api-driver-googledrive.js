const moment = require('moment');
const { time } = require('lib/time-utils.js');
const { dirname, basename } = require('lib/path-utils.js');
const { basicDelta } = require('lib/file-api');
const { shim } = require('lib/shim');

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

	async createEmptyFile_(parentId, name, mimeType) {
		const query = {}
		const body = {
			name: name,
			mimeType: mimeType,
			parents: [parentId],
		}
		const result = await this.api_.execJson("POST", "https://www.googleapis.com/drive/v3/files", query, body);
		return result;
	}

	async updateFileContent_(fileId, options) {
		const url = "https://www.googleapis.com/upload/drive/v3/files/" + fileId;
		const query = {
			uploadType: "media", // Upload simples, apenas mídia até 5MB
		}
		let response = await this.api_.exec('PATCH', url, query, null, options);
		return response;
	}

	async updateFileTextContent_(fileId, content, options) {
		const url = "https://www.googleapis.com/upload/drive/v3/files/" + fileId;
		const query = {
			uploadType: "media", // Upload simples, apenas mídia até 5MB
		}
		let response = await this.api_.exec('PATCH', url, query, content, options);
		return response;
	}


	async updateFileMetadata_(fileId, metadata) {
		const url = "https://www.googleapis.com/drive/v3/files/" + fileId;
		const response = await this.api_.exec("PATCH", url, null, metadata);
		return response;
	}

	/**
	 * @returns Metadados do arquivo encontrado (ou null caso não tenha encontrado).
	 */
	async getChildFileMetadata_(parentId, childName, childMimeType, createIfDoesntExists = false) {
		let result = null;
		let q = `'${parentId}' in parents`;
		if (childName) q += ` and name = '${childName}'`;
		if (childMimeType) q += ` and mimeType = '${childMimeType}'`;

		const listResult = await this.listFilesSummaryMetadatas_(q);
		if (listResult && listResult.files && listResult.files[0]) {
			const id = listResult.files[0].id;
			result = await this.getFileMetadata_(id);
		}
		if (result === null && createIfDoesntExists) {
			result = await this.createEmptyFile_(parentId, childName, childMimeType);
		}
		return result;
	}

	/**
	 * Obtém os metadados do arquivo com o ID especificado.
	 */
	async getFileMetadata_(fileId) {
		const query = {
			fields: "id, name, mimeType, modifiedTime, modifiedByMeTime, trashed",
		}

		const result = await this.api_.execJson("GET", "https://www.googleapis.com/drive/v3/files/" + fileId, query);
		return result;
	}

	async getFileTextContent_(fileId) {
		const query = {
			alt: "media",
		};

		try {
			let content = await this.api_.execText("GET", "https://www.googleapis.com/drive/v3/files/" + fileId, query);
			return content + '';
		} catch (error) {
			if (error.code == '404') return null;
			throw error;
		}
	}

	async getFileContent_(fileId, options) {
		const url = "https://www.googleapis.com/drive/v3/files/" + fileId;

		const query = {
			alt: "media",
		};

		try {
			let response = await this.api_.exec('GET', url, query, null, options);
			return response;
		} catch (error) {
			if (error.code == '404') return null;
			throw error;
		}
	}

	/**
	 * Remove um arquivo com o ID especificado.
	 */
	async deleteFile_(fileId) {
		const url = "https://www.googleapis.com/drive/v3/files/" + fileId;
		const result = await this.api_.exec("DELETE", url);
		return result;
	}

	/**
	 * Obtém (e cria, se necessário) a pasta raiz do aplicativo no Drive.
	 */
	async getRootFolderMetadata_() {
		const rootId = "appDataFolder";
		return await this.getFileMetadata_(rootId);
	}

	/**
	 * Busca por arquivos com os parâmetros definidos. Retorna apenas 4 campos
	 * para cada arquivo: kind, id, name, mimeType.
	 * 
	 * @param {*} q Parâmetros de busca. Leia sobre em "https://developers.google.com/drive/api/v3/search-parameters".
	 */
	async listFilesSummaryMetadatas_(q, additionalParams = {}) {
		const baseParams = {
			spaces: "appDataFolder",
			q: q,
		};
		const params = Object.assign(baseParams, additionalParams);
		const result = await this.api_.execJson("GET", "https://www.googleapis.com/drive/v3/files", params);
		return result;
	}

	metadataToStat_(metadata, path) {
		let filePath = metadata.name;
		if (!path) path = "";
		if (path.length > 0) filePath = path + "/" + filePath;
		let output = {
			path: filePath,
			isDir: metadata.mimeType == this.folderMimeType_(),
			updated_time: moment(metadata.modifiedTime, 'YYYY-MM-DDTHH:mm:ss.SSSZ').format('x'),
			isDeleted: metadata.trashed,
		}
		return output;
	}

	/**
	 * Busca o ID de um arquivo do Google Drive, com base num path.
	 * @param {*} path Path a ser procurado no Drive.
	 * @param {*} createIfDoesntExists Cria os arquivos/pastas faltando no path.
	 * @param {*} mimeType MIME type usado se o arquivo não existir e tiver que
	 * ser criado (e não for uma pasta).
	 */
	async pathToFileId_(path, createIfDoesntExists = true, mimeType = null) {
		const pathParts = path.split(/\\|\//g);
		const rootFolder = await this.getRootFolderMetadata_();
		let currentId = rootFolder.id;
		for (let i = 0; i < pathParts.length; i++) {
			const fileName = pathParts[i];
			// Assume que é uma pasta sempre que não for o último no path ou
			// começar com ponto
			const isFolder = i < pathParts.length - 1 || fileName.startsWith(".");
			if (isFolder) {
				const folder = await this.getChildFileMetadata_(currentId, fileName, this.folderMimeType_(), createIfDoesntExists);
				if (!folder) return null;
				currentId = folder.id;
			} else {
				const file = await this.getChildFileMetadata_(currentId, fileName, mimeType, createIfDoesntExists);
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
		const itemId = await this.pathToFileId_(path, false);
		if (!itemId) return null;
		const metadata = await this.getFileMetadata_(itemId);
		if (!metadata) return null;
		const stat = this.metadataToStat_(metadata);
		return stat;
	}

	async list(path, options = null) { // CONCLUÍDO
		if (!options) options = {};

		let folderId;
		if (!path || path.length == 0) {
			const rootFolder = await this.getRootFolderMetadata_();
			folderId = rootFolder.id;
		} else {
			folderId = await this.pathToFileId_(path, true);
		}

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

		let query = `\"${folderId}\" in parents`;
		let result = await this.listFilesSummaryMetadatas_(query, additionalParams);
		let items = [];
		if (result.files && result.files.length > 0) {
			for (let i = 0; i < result.files.length; i++) {
				const fileSummary = result.files[i];
				const metadata = await this.getFileMetadata_(fileSummary.id);
				const stat = this.metadataToStat_(metadata, path);
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

	async get(path, options = null) {

		if (!options) options = {};
		if (!options.target) options.target = 'string';

		const fileId = await this.pathToFileId_(path, false);
		if (!fileId) {
			return null;
		}

		let result;
		try {
			if (options.target == 'file') {
				result = await this.getFileContent_(fileId, options);
			} else {
				result = await this.getFileTextContent_(fileId);
			}
		} catch (error) {
			console.log(error);
			throw error;
		}
		return result;
	}

	async put(path, content, options = null) {
		if (!options) options = {};

		let fileId, result;
		if (options.source == "file") {
			fileId = await this.pathToFileId_(path, true, "application/octet-stream");
			result = await this.updateFileContent_(fileId, options);
		} else {
			options.headers = { 'Content-Type': "text/plain" };
			fileId = await this.pathToFileId_(path, true, "text/plain");
			result = await this.updateFileTextContent_(fileId, content, options);
		}

		return result;
	}

	async delete(path) {
		const fileId = await this.pathToFileId_(path, false);
		if (!fileId) { return; }
		let result = await this.deleteFile_(fileId);
		return result;
	}

	async move(oldPath, newPath) {
		throw new Error('Not implemented');

		// const movedFileId = await this.pathToFileId_(oldPath, false);
		// if (!movedFileId) throw new Error("Can't find the path to move");
		// const movedFile = await this.getFileMetadata_(movedFileId);

		// const newFileId = await this.pathToFileId_(newPath, false);
		// if (newFileId) throw new Error("New path already exists");

		// const parentMatch = newPath.match(/(.+)[\\|\/](.*)/); // Everything before the first / or \
		// const newName = parentMatch ? parentMatch[2] : newPath;
		// const newParentPath = parentMatch ? parentMatch[1] : "";
		// const newParentId = await this.pathToFileId_(newParentPath, true);
		// const previousModifiedTime = movedFile.modifiedTime;
		// const previousModifiedByMeTime = movedFile.modifiedByMeTime;

		// await this.updateFileMetadata_(movedFileId, {
		// 	name: newName,
		// 	parents: [
		// 		newParentId,
		// 	],
		// 	// We don't want to change the modified time
		// 	modifiedTime: previousModifiedTime,
		// 	modifiedByMeTime: previousModifiedByMeTime,
		// });

		// return this.metadataToStat_(movedFile);
	}

	async setTimestamp(path, timestamp) {
		throw new Error('Not implemented');
	}

	format() {
		throw new Error('Not implemented');
	}

	clearRoot() {
		throw new Error('Not implemented');
	}

}

module.exports = { FileApiDriverGoogleDrive };