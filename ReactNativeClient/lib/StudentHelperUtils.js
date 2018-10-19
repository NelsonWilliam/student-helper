
const Folder = require('lib/models/Folder.js');

let StudentHelperUtils = {};

StudentHelperUtils.folderHasAnyChildren = function (folderId, folders) {
    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        if (folder.parent_id === folderId) {
            return true;
        }
    }
    return false;
}

/**
 * Used to find a folder in the folders array instead of using Folder.load.
 */
StudentHelperUtils.getFolder = function (selectedFolderId, folders) {
    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        if (folder.id === selectedFolderId) {
            return folder;
        }
    }
    return null;
}

StudentHelperUtils.isSemesterFolder = function (folderId, folders) {
    if (folderId == Folder.conflictFolderId()) return false;
    const folder = StudentHelperUtils.getFolder(folderId, folders);
    if (folder == null) return false;
    return !folder.parent_id;
}


StudentHelperUtils.isCourseFolder = function (folderId, folders) {
    const folder = StudentHelperUtils.getFolder(folderId, folders);
    if (folder == null) return false;
    const folderParentId = folder.parent_id;
    if (!folderParentId) return false;
    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        if (folder.id === folderParentId) {
            return !folder.parent_id;
        }
    }
    return false;
}

StudentHelperUtils.isSemesterSelected = function (selectedFolderId, folders, notesParentType) {
    if (notesParentType !== 'Folder') return false;
    return StudentHelperUtils.isSemesterFolder(selectedFolderId, folders);
}

StudentHelperUtils.isCourseSelected = function (selectedFolderId, folders, notesParentType) {
    if (notesParentType !== 'Folder') return false;
    return StudentHelperUtils.isCourseFolder(selectedFolderId, folders);    
}

StudentHelperUtils.syncTargetNameIs = function(name) {
    const Setting = require('lib/models/Setting.js');
    const SyncTargetRegistry = require('lib/SyncTargetRegistry.js');

    const SyncTargetClass = SyncTargetRegistry.classById(Setting.value('sync.target'));
    return SyncTargetClass.targetName().indexOf(name) >= 0;
}

module.exports = StudentHelperUtils;