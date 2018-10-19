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

	async updateFileContent_(fileId, content, options) {
		// Upload de mídia requer definir o uploadType na query e enviar os
		// dados do arquivo no body, com a url com PUT se o arquivo já existir.
		const url = "https://www.googleapis.com/upload/drive/v3/files/" + fileId;

		const query = {
			uploadType: "media", // Upload simples, apenas mídia e até 5MB
		}

		let response;
		try {
			response = await this.api_.exec('PATCH', url, query, content, options);
		} catch (error) {
			throw error;
		}

		return response;
	}


	async updateFileMetadata_(fileId, metadata) {
		// Atualização de metadados não requer uploadType, basta enviar os novos
		// metadados no body pra url com PATCH.
		const url = "https://www.googleapis.com/drive/v3/files/" + fileId;
		const result = await this.api_.execJson("PATCH", url, {}, metadata);
		return result;
	}

	/**
	 * @returns Metadados do arquivo encontrado (ou null caso não tenha encontrado).
	 */
	async getChildFileMetadata_(parentId, childName, childMimeType, createIfDoesntExists = false) {
		let result = null;
		let q = `'${parentId}' in parents`;
		if (childName) q += ` and name = '${childName}'`;
		if (childMimeType) q += ` and mimeType = '${childMimeType}'`;
		const listResult = await this.listFilesMetadatas_(q);
		if (listResult && listResult.files && listResult.files[0]) {
			result = listResult.files[0];
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
		const result = await this.api_.execJson("GET", "https://www.googleapis.com/drive/v3/files/" + fileId, {}, {});
		return result;
	}

	async getFileTextContent_(fileId) {
		const query = {
			alt: "media",
		};

		try {
			let content = await this.api_.execText("GET", "https://www.googleapis.com/drive/v3/files/" + fileId, query, {});
			return content + '';
		} catch (error) {
			if (error.code == '404') return null;
			throw error;
		}
	}

	async getFileContent_(fileId) {
		const query = {
			alt: "media",
		};

		try {
			let response = await this.api_.exec("GET", "https://www.googleapis.com/drive/v3/files/" + fileId, query, {});
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
	async getRootFolderMetadata_() {
		const rootId = "root";
		return await this.getChildFileMetadata_(rootId, "Joplin", this.folderMimeType_(), true);
		// NOTE: Depois deve mudar isso para:
		// return await this.getFileRaw_("appDataFolder");
	}

	/**
	 * Busca por arquivos com os parâmetros definidos.
	 * @param {*} q Parâmetros de busca. Leia sobre em "https://developers.google.com/drive/api/v3/search-parameters".
	 */
	async listFilesMetadatas_(q, additionalParams = {}) {
		const baseParams = {
			spaces: "drive", // NOTE: Depois deve mudar isso pra "appDataFolder"
			q: q,
		};
		const params = Object.assign(baseParams, additionalParams);
		const result = await this.api_.execJson("GET", "https://www.googleapis.com/drive/v3/files", params);
		return result;
	}

	metadataToStat_(metadata, path) {
		let filePath = metadata.name;
		if (path.length > 0) filePath = path + "/" + filePath;
		let output = {
			path: filePath,
			isDir: metadata.mimeType == this.folderMimeType_(),
			updated_time: metadata.modifiedTime ? new Date(md.modifiedTime) : new Date(),
			isDeleted: metadata.trashed ? metadata.trashed : false,
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
	async pathToFileId_(path, createIfDoesntExists = true, mimeType = "text/plain") {
		if (!path) return null;
		const pathParts = path.split("/|\"");
		const rootFolder = await this.getRootFolderMetadata_();
		let currentId = rootFolder.id;
		for (let i = 0; i < pathParts.length; i++) {
			const fileName = pathParts[i];
			// Assume que é uma pasta sempre que não for o último no path ou não tiver extensão
			const isFolder = i < pathParts.length - 1 || fileName.substr(1).indexOf(".") < 0;
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
		try {
			let item = await this.getFileMetadata_(path);
			return this.metadataToStat_(item);
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


		let folderId;
		if (!path || path.length == 0) {
			const rootFolder = await this.getRootFolderMetadata_();
			folderId = rootFolder.id;
		} else {
			return await this.pathToFileId_(path, true);
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
		let result = await this.listFilesMetadatas_(query, additionalParams);
		let items = [];
		if (result.files && result.files.length > 0) {
			for (let i = 0; i < result.files.length; i++) {
				const file = result.files[i];
				const stat = this.metadataToStat_(file, path);
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

	async get(path, options = null) { // CONCLUÍDO, MAS TALVEZ TENHA BUGS COM ARQUIVOS NÃO TEXTUAIS
		if (!options) options = {};
		if (!options.target) options.target = 'string';
		if (!options.responseFormat) options.responseFormat = 'text';

		const fileId = await this.pathToFileId_(path, false);
		if (!fileId) {
			throw error;
		}

		let result;
		if (options.target == 'file') {
			result = await this.getFileContent_(fileId);
		} else {
			result = await this.getFileTextContent_(fileId);
		}
		return result;
	}

	async put(path, content, options = null) { // CONCLUÍDO, MAS TALVEZ TENHA BUGS COM ARQUIVOS NÃO TEXTUAIS
		if (!options) options = {};

		if (typeof content === 'string') {
			options.headers = { 'Content-Type': 'text/plain' };
		}

		const fileId = await this.pathToFileId_(path, true, "text/plain");
		const result = await this.updateFileContent_(fileId, content, options);
		return result;
	}

	async delete(path) { // TALVEZ ESTEJA PRONTO...
		const fileId = await this.pathToFileId_(path, false);
		let result = await this.deleteFile_(fileId);
		return {
			result: result
		}
	}

	async move(oldPath, newPath) { // FALTA FAZER/VERIFICAR
		const fileId = await this.pathToFileId_(oldPath, false);
		const result = await this.updateFileMetadata_(fileId, newPath);
		return await result;

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

	async setTimestamp(path, timestamp) { // ACHO QUE NÃO PRECISA FAZER ESSE
		throw new Error('Not implemented');
	}

	format() { // ACHO QUE NÃO PRECISA FAZER ESSE
		throw new Error('Not implemented');
	}

	clearRoot() { // ACHO QUE NÃO PRECISA FAZER ESSE
		throw new Error('Not implemented');
	}

}

module.exports = { FileApiDriverGoogleDrive };