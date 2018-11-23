const { ItemList } = require('./ItemList.min.js');
const React = require('react');
const { connect } = require('react-redux');
const { time } = require('lib/time-utils.js');
const { themeStyle } = require('../theme.js');
const Note = require('lib/models/Note.js');
const BaseModel = require('lib/BaseModel');
const { _ } = require('lib/locale.js');
const { bridge } = require('electron').remote.require('./bridge');
const Menu = bridge().Menu;
const MenuItem = bridge().MenuItem;
const eventManager = require('../eventManager');
const InteropService = require('lib/services/InteropService');
const InteropServiceHelper = require('../InteropServiceHelper.js');
const Search = require('lib/models/Search');
const Mark = require('mark.js/dist/mark.min.js');
const StudentHelperUtils = require('lib/StudentHelperUtils.js');

class NoteListComponent extends React.Component {

	style() {
		const theme = themeStyle(this.props.theme);

		const itemHeight = 34;

		let style = {
			root: {
				backgroundColor: theme.backgroundColor,
			},
			listItem: {
				height: itemHeight,
				boxSizing: 'border-box',
				display: 'flex',
				alignItems: 'stretch',
				backgroundColor: theme.backgroundColor,
				borderBottom: '1px solid ' + theme.dividerColor,
			},
			listItemSelected: {
				backgroundColor: theme.selectedColor,
			},
			listItemTitle: {
				fontFamily: theme.fontFamily,
				fontSize: theme.fontSize,
				textDecoration: 'none',
				color: theme.color,
				cursor: 'default',
				whiteSpace: 'nowrap',
				flex: 1,
				display: 'flex',
				alignItems: 'center',
				overflow: 'hidden',
			},
			listItemTitleCompleted: {
				opacity: 0.5,
				textDecoration: 'line-through',
			},
			header: {
				height: itemHeight * 1.2,
				fontFamily: theme.fontFamily,
				fontSize: theme.fontSize * 1.3,
				textDecoration: "none",
				boxSizing: "border-box",
				color: theme.backgroundColor2,
				padding: "12px 0 0 8px",
				display: "flex",
				alignItems: "center",
			},
			message: {
				height: itemHeight * 0.75,
				padding: '0 10px',
				fontSize: theme.fontSize,
				color: theme.color,
				backgroundColor: theme.backgroundColor,
				fontFamily: theme.fontFamily,
			},
			gradesTotal: {
				height: itemHeight * 0.66,
				padding: '0 10px',
				fontSize: theme.fontSize,
				color: theme.color,
				backgroundColor: theme.backgroundColor,
				fontFamily: theme.fontFamily,
				fontWeight: "bold",
			},
			absences: {
				height: itemHeight * 0.75,
				padding: '0 10px',
				fontSize: theme.fontSize,
				color: theme.color,
				backgroundColor: theme.backgroundColor,
				fontFamily: theme.fontFamily,
			}
		};

		return style;
	}

	itemContextMenu(event) {
		const currentItemId = event.currentTarget.getAttribute('data-id');
		if (!currentItemId) return;

		let noteIds = [];
		if (this.props.selectedNoteIds.indexOf(currentItemId) < 0) {
			noteIds = [currentItemId];
		} else {
			noteIds = this.props.selectedNoteIds;
		}

		if (!noteIds.length) return;

		const notes = noteIds.map((id) => BaseModel.byId(this.props.notes, id));

		let hasEncrypted = false;
		for (let i = 0; i < notes.length; i++) {
			if (!!notes[i].encryption_applied) hasEncrypted = true;
		}

		const menu = new Menu()

		if (!hasEncrypted) {
			menu.append(new MenuItem({
				label: _('Add or remove tags'), enabled: noteIds.length === 1, click: async () => {
					this.props.dispatch({
						type: 'WINDOW_COMMAND',
						name: 'setTags',
						noteId: noteIds[0],
					});
				}
			}));

			menu.append(new MenuItem({
				label: _('Duplicate'), click: async () => {
					for (let i = 0; i < noteIds.length; i++) {
						const note = await Note.load(noteIds[i]);
						await Note.duplicate(noteIds[i], {
							uniqueTitle: _('%s - Copy', note.title),
						});
					}
				}
			}));

			menu.append(new MenuItem({
				label: _('Switch between note and to-do type'), click: async () => {
					for (let i = 0; i < noteIds.length; i++) {
						const note = await Note.load(noteIds[i]);
						await Note.save(Note.toggleIsTodo(note), { userSideValidation: true });
						eventManager.emit('noteTypeToggle', { noteId: note.id });
					}
				}
			}));

			menu.append(new MenuItem({
				label: _('Copy Markdown link'), click: async () => {
					const { clipboard } = require('electron');
					const links = [];
					for (let i = 0; i < noteIds.length; i++) {
						const note = await Note.load(noteIds[i]);
						links.push(Note.markdownTag(note));
					}
					clipboard.writeText(links.join(' '));
				}
			}));

			const exportMenu = new Menu();

			const ioService = new InteropService();
			const ioModules = ioService.modules();
			for (let i = 0; i < ioModules.length; i++) {
				const module = ioModules[i];
				if (module.type !== 'exporter') continue;

				exportMenu.append(new MenuItem({
					label: module.fullLabel(), click: async () => {
						await InteropServiceHelper.export(this.props.dispatch.bind(this), module, { sourceNoteIds: noteIds });
					}
				}));
			}

			exportMenu.append(new MenuItem({
				label: 'PDF - ' + _('PDF File'), click: () => {
					this.props.dispatch({
						type: 'WINDOW_COMMAND',
						name: 'exportPdf',
					});
				}
			}));

			const exportMenuItem = new MenuItem({ label: _('Export'), submenu: exportMenu });

			menu.append(exportMenuItem);
		}

		menu.append(new MenuItem({
			label: _('Delete'), click: async () => {
				const ok = bridge().showConfirmMessageBox(noteIds.length > 1 ? _('Delete notes?') : _('Delete note?'));
				if (!ok) return;
				await Note.batchDelete(noteIds);
			}
		}));

		menu.popup(bridge().window());
	}

	itemRenderer(item, theme, width) {
		const onTitleClick = async (event, item) => {
			if (event.ctrlKey) {
				event.preventDefault();
				this.props.dispatch({
					type: 'NOTE_SELECT_TOGGLE',
					id: item.id,
				});
			} else if (event.shiftKey) {
				event.preventDefault();
				this.props.dispatch({
					type: 'NOTE_SELECT_EXTEND',
					id: item.id,
				});
			} else {
				this.props.dispatch({
					type: 'NOTE_SELECT',
					id: item.id,
				});
			}
		}

		const onDragStart = (event) => {
			let noteIds = [];

			// Here there is two cases:
			// - If multiple notes are selected, we drag the group
			// - If only one note is selected, we drag the note that was clicked on (which might be different from the currently selected note)
			if (this.props.selectedNoteIds.length >= 2) {
				noteIds = this.props.selectedNoteIds;
			} else {
				const clickedNoteId = event.currentTarget.getAttribute('data-id');
				if (clickedNoteId) noteIds.push(clickedNoteId);
			}

			if (!noteIds.length) return;

			event.dataTransfer.setDragImage(new Image(), 1, 1);
			event.dataTransfer.clearData();
			event.dataTransfer.setData('text/x-jop-note-ids', JSON.stringify(noteIds));
		}

		const onCheckboxClick = async (event) => {
			const checked = event.target.checked;
			const newNote = {
				id: item.id,
				todo_completed: checked ? time.unixMs() : 0,
			}
			await Note.save(newNote, { userSideValidation: true });
			eventManager.emit('todoToggle', { noteId: item.id });
		}

		const hPadding = 10;

		let highlightedWords = [];
		if (this.props.notesParentType === 'Search') {
			const search = BaseModel.byId(this.props.searches, this.props.selectedSearchId);
			highlightedWords = search ? Search.keywords(search.query_pattern) : [];
		}

		let style = Object.assign({ width: width }, this.style().listItem);

		if (this.props.selectedNoteIds.indexOf(item.id) >= 0) {
			style = Object.assign(style, this.style().listItemSelected);
		}

		// Setting marginBottom = 1 because it makes the checkbox looks more centered, at least on Windows
		// but don't know how it will look in other OSes.
		const checkbox = item.is_todo ?
			<div style={{ display: 'flex', height: style.height, alignItems: 'center', paddingLeft: hPadding }}>
				<input style={{ margin: 0, marginBottom: 1 }} type="checkbox" defaultChecked={!!item.todo_completed} onClick={(event) => { onCheckboxClick(event, item) }} />
			</div>
			: null;

		let listItemTitleStyle = Object.assign({}, this.style().listItemTitle);
		listItemTitleStyle.paddingLeft = !checkbox ? hPadding : 4;
		if (item.is_todo && !!item.todo_completed) listItemTitleStyle = Object.assign(listItemTitleStyle, this.style().listItemTitleCompleted);

		let displayTitle = Note.displayTitle(item);
		let titleComp = null;

		if (highlightedWords.length) {
			const titleElement = document.createElement('span');
			titleElement.textContent = displayTitle;
			const mark = new Mark(titleElement, {
				exclude: ['img'],
				acrossElements: true,
			});
			mark.mark(highlightedWords);

			// Note: in this case it is safe to use dangerouslySetInnerHTML because titleElement
			// is a span tag that we created and that contains data that's been inserted as plain text
			// with `textContent` so it cannot contain any XSS attacks. We use this feature because
			// mark.js can only deal with DOM elements.
			// https://reactjs.org/docs/dom-elements.html#dangerouslysetinnerhtml
			titleComp = <div style={{width: "100%"}} dangerouslySetInnerHTML={{ __html: titleElement.outerHTML }}></div>
		} else {
			titleComp = <div style={{width: "100%"}}>{displayTitle}</div>
		}

		//let dueDate = null;
		//if (item.is_todo && !item.todo_completed) {
		//	dueDate = <div style={{minWidth: "100px", color:"#666"}}> {time.formatMsToLocal(item.todo_due)}</div>;
		//}

		// Need to include "todo_completed" in key so that checkbox is updated when
		// item is changed via sync.		
		return <div className="list-item" key={item.id + '_' + item.todo_completed} style={style}>
			{checkbox}
			<a
				onContextMenu={(event) => this.itemContextMenu(event)}
				href="#"
				draggable={true}
				style={listItemTitleStyle}
				onClick={(event) => { onTitleClick(event, item) }}
				onDragStart={(event) => onDragStart(event)}
				data-id={item.id}
			>
				{titleComp}
			</a>
		</div>
	}

	makeHeader(key, label, iconName, extraProps = {}) {
		const style = this.style().header;
		const icon = <i style={{ fontSize: style.fontSize * 1.2, marginRight: 5 }} className={"fa " + iconName} />;
		return (
			<div style={style} key={key} {...extraProps}>
				{icon}
				{label}
			</div>
		);
	}

	makeMessage(key, message, style) {
		const actualStyle = style === undefined ? this.style().message : style;
		return (<div style={actualStyle} key={key}>{message}</div>);
	}

	makeItemList(key, items, itemRenderer, maxHeight, emptyMessage) {
		if (items.length) {
			const listStyle = {
				height: maxHeight,
			};
			return (
				<ItemList
					key={key + '_items'}
					itemHeight={this.style().listItem.height}
					style={listStyle}
					className={"note-list"}
					items={items}
					itemRenderer={itemRenderer}
				/>);
		} else {
			return (this.makeMessage(key + "_emptyMessage", emptyMessage));
		}
	}

	makeGradesHeader(key, label, iconName, gradesLength, extraProps = {}) {
		const style = Object.assign({}, this.style().header);
		const icon = <i style={{ marginRight: 5 }} className={"fa " + iconName} />;

		return (
			<div style={style} key={key} {...extraProps}>
				<table style={{ width: "100%" }}>
					<tr>
						<th style={{ width: "100%", border: "0", padding: "0", fontWeight: "normal", fontSize: style.fontSize * 1 }}>
							{icon}
							{label}
						</th>
						{gradesLength > 0 && <th style={{ minWidth: "45px", fontAlign: "center", border: "0", paddingRight: "12px", fontWeight: "normal", fontSize: style.fontSize * 0.7 }}>Weights</th>}
						{gradesLength > 0 && <th style={{ minWidth: "46px", fontAlign: "center", border: "0", padding: "0", fontWeight: "normal", fontSize: style.fontSize * 0.7 }}>Values</th>}
						{gradesLength > 0 && <th style={{ minWidth: "30px", border: "0", padding: "0", fontWeight: "normal", fontSize: style.fontSize * 0.7 }}></th>}
					</tr>
				</table>
			</div>
		);
	}

	gradeRenderer(item, theme, width, isTotal) {
		let style = Object.assign({ width: width, }, this.style().listItem);
		let listItemTitleStyle = Object.assign({}, this.style().listItemTitle);

		let weight = item.weight != null && <input type="number" min="0" value={item.weight} style={{ width: "40px" }} />;
		let value = null;
		if (item.value != null) {
			if (isTotal) {
				value = <span>{item.value}</span>
			} else {
				value = <input type="number" min="0" value={item.value} style={{ width: "40px" }} />;
			}
		}
		let addOrDelete;
		if (isTotal) {
			addOrDelete = <a href="#"><i style={{ fontSize: "16px", color: theme.backgroundColor2 }} className={"fa fa-plus"} /></a>;
		} else {
			addOrDelete = <a href="#"><i style={{ fontSize: "16px", color: theme.backgroundColor2 }} className={"fa fa-trash-o"} /></a>;
		}

		return <div className="list-item" key={"grade_" + item.id} style={style}>
			<a
				href="#"
				draggable={false}
				style={listItemTitleStyle}
				data-id={item.id}
			>
				<table style={{ width: "100%" }}>
					<tr>
						<th style={{ width: "100%", border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{item.title}</th>
						<th style={{ border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{weight}</th>
						<th style={{ border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{value}</th>
						<th style={{ minWidth: "16px", border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{addOrDelete}</th>
					</tr>
				</table>
			</a>
		</div>
	}


	makeGradesSection(height, grades) {
		const theme = themeStyle(this.props.theme);
		const listHeight = grades.length ? grades.length * this.style().listItem.height : this.style().listItem.height;
		const gradeRenderer = (item) => { return this.gradeRenderer(item, theme, this.props.style.width, false) };

		// Calcula a media final
		let finalGradeValue = 0;
		let weightsSum = 0;
		for (let i = 0; i < grades.length; i++) {
			const element = grades[i];
			finalGradeValue += element.weight * element.value;
			weightsSum += element.weight;
		}
		finalGradeValue /= weightsSum;

		// Cria o item que vai conter a media final
		const finalGradeItem = {
			id: "1n29e9n7129h129912e19b2en912eb97192beb912e80h1208ne",
			title: "Final grade",
			value: finalGradeValue,
		};

		const gradesHeaderContextMenu = function (props, event) {
			const itemId = event.target.getAttribute("data-id");
			if (itemId === Folder.conflictFolderId()) return;

			const menu = new Menu();
			menu.append(
				new MenuItem({
					label: _("New grade item"),
					click: async () => {
						// TODO: Implement add new grade item.
						// props.dispatch({
						// 	type: 'WINDOW_COMMAND',
						// 	name: 'newGradeItem',
						// });
					},
				})
			);
			menu.popup(bridge().window());
		}

		let elements = [];
		elements.push(this.makeGradesHeader("grades_header", _("Grades"), "fa-trophy", grades.length, {
			onContextMenu: (event) => { gradesHeaderContextMenu(this.props, event) },
		}));
		elements.push(this.makeItemList("grades_list", grades, gradeRenderer, listHeight, _("There are no grades.")));
		if (grades.length) {
			elements.push(this.gradeRenderer(finalGradeItem, theme, this.props.style.width, true));
		}
		return elements;
	}

	absencesRenderer(absences, total) {
		return (
			<div>
				<label>I missed </label>
				<input type="number" min="0" value={absences} style={{ width: "35px" }} />
				<label> out of </label>
				<input type="number" min="0" value={total} style={{ width: "35px" }} />
				<label> classes ({(100 * absences / total).toPrecision(2)}%) </label>
			</div>
		);
	}

	makeAbsencesSection(absences, total) {
		// TODO: Convert those numbers into input fields that actually work.
		const absencesStyle = this.style().absences;
		const message = this.absencesRenderer(absences, total);

		let elements = [];
		elements.push(this.makeHeader("absences_header", _("Absences"), "fa-calendar-times-o"));
		elements.push(this.makeMessage("absences_message", message, absencesStyle));
		return elements;
	}

	makeTodosSection(height, todos) {
		const theme = themeStyle(this.props.theme);
		const headerStyle = this.style().header;
		const targetHeight = todos.length * this.style().listItem.height;
		const maxHeight = height - headerStyle.height;
		const listHeight = Math.min(targetHeight, maxHeight);
		const todoRenderer = (item) => { return this.itemRenderer(item, theme, this.props.style.width) };

		const todosHeaderContextMenu = function (props, event) {
			const itemId = event.target.getAttribute("data-id");
			if (itemId === Folder.conflictFolderId()) return;

			const menu = new Menu();
			menu.append(
				new MenuItem({
					label: _("New assignment"),
					click: async () => {
						props.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newTodo',
						});
					},
				})
			);
			menu.popup(bridge().window());
		}

		let emptyMessage = _("There are no assignments.");
		if (this.props.notesParentType === 'Search') {
			emptyMessage = _("No assignments were found.");
		} else if (this.props.notesParentType === 'Tag') {
			emptyMessage = _("There are no assignments with this tag.");
		}

		let elements = [];
		elements.push(this.makeHeader("todos_header", _("Assignments"), "fa-clock-o", {
			onContextMenu: (event) => { todosHeaderContextMenu(this.props, event) },
		}));
		elements.push(this.makeItemList("todos_list", todos, todoRenderer, listHeight, emptyMessage));
		return elements;
	}

	makeNotesSection(height, notes) {
		const theme = themeStyle(this.props.theme);
		const headerStyle = this.style().header;
		const targetHeight = notes.length * this.style().listItem.height;
		const maxHeight = height - headerStyle.height;
		const listHeight = Math.min(targetHeight, maxHeight);
		const noteRenderer = (item) => { return this.itemRenderer(item, theme, this.props.style.width) };

		const notesHeaderContextMenu = function (props, event) {
			const itemId = event.target.getAttribute("data-id");
			if (itemId === Folder.conflictFolderId()) return;

			const menu = new Menu();
			menu.append(
				new MenuItem({
					label: _("New note"),
					click: async () => {
						props.dispatch({
							type: 'WINDOW_COMMAND',
							name: 'newNote',
						});
					},
				})
			);
			menu.popup(bridge().window());
		}

		let emptyMessage = _("There are no notes.");
		if (this.props.notesParentType === 'Search') {
			emptyMessage = _("No notes were found.");
		} else if (this.props.notesParentType === 'Tag') {
			emptyMessage = _("There are no notes with this tag.");
		}

		let elements = [];
		elements.push(this.makeHeader("notes_header", _("Notes"), "fa-file-o", {
			onContextMenu: (event) => { notesHeaderContextMenu(this.props, event) },
		}));
		elements.push(this.makeItemList("notes_list", notes, noteRenderer, listHeight, emptyMessage));
		return elements;
	}

	render() {
		// NOTE: This component was repurposed to render a course's partial
		// grades, absences, assignments (to-dos), notes separated in sections.

		// TODO: Features related to sorting (the ones in the View menu) are
		// working weirdly, since we changed how notes and todos are displayed.
		// Fix that!

		const style = this.props.style;
		const folders = this.props.folders;
		const notesAndTodos = this.props.notes.slice();
		const selectedFolderId = this.props.selectedFolderId;
		const notesParentType = this.props.notesParentType;
		const isSemesterSelected = StudentHelperUtils.isSemesterSelected(selectedFolderId, folders, notesParentType);
		const isCourseSelected = StudentHelperUtils.isCourseSelected(selectedFolderId, folders, notesParentType);
		const soloMessageStyle = Object.assign(this.style().message, {
			padding: "10px 10px"
		});

		if (!this.props.folders.length) {
			return (
				<div style={style}>
					{this.makeMessage("noFolders_message", _("Click on the 'New semester' button to create a Semester."), soloMessageStyle)}
				</div>
			);
		}

		const notes = notesAndTodos.filter(i => !!!i.is_todo);
		const todos = notesAndTodos.filter(i => !!i.is_todo);

		// TODO: Fetch the correct values once those features are implemented.
		const grades = [{ id: "qwqwqwqwqqw", title: "Prova 1", weight: 3, value: 8 },
		{ id: "qwqwq123wqwqqw", title: "Prova 2", weight: 2, value: 6 },
		{ id: "qwqwq6277wqwqqw", title: "Trabalhos", weight: 3, value: 0 }];
		const absences = 16;
		const totalAbsences = 64;

		const totalHeight = style.height;
		const absencesHeight = this.style().header.height + this.style().absences.height;
		const sectionsHeight = totalHeight - absencesHeight;
		const gradesHeight = sectionsHeight * 0.25;
		const todosHeight = sectionsHeight * 0.375;
		const notesHeight = sectionsHeight * 0.375;

		let items = [];
		if (isSemesterSelected) {
			const message = StudentHelperUtils.folderHasAnyChildren(selectedFolderId, folders)
				? _("Select a Course within this Semester to see its details.")
				: _("Click on the 'New course' to add a Course to this semester.");
			items.push(this.makeMessage("semester_message", message, soloMessageStyle));
		}
		else {
			if (isCourseSelected) {
				items.push(this.makeGradesSection(gradesHeight, grades));
				items.push(this.makeAbsencesSection(absences, totalAbsences));
			}
			items.push(this.makeTodosSection(todosHeight, todos));
			items.push(this.makeNotesSection(notesHeight, notes));
		}

		return (
			<div style={style}>
				{items}
			</div>
		);
	}

}

const mapStateToProps = (state) => {
	return {
		notes: state.notes,
		folders: state.folders,
		selectedFolderId: state.selectedFolderId,
		selectedNoteIds: state.selectedNoteIds,
		theme: state.settings.theme,
		notesParentType: state.notesParentType,
		searches: state.searches,
		selectedSearchId: state.selectedSearchId,
	};
};

const NoteList = connect(mapStateToProps)(NoteListComponent);

module.exports = { NoteList };