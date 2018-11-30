const { ItemList } = require('./ItemList.min.js');
const React = require('react');
const { connect } = require('react-redux');
const { time } = require('lib/time-utils.js');
const { themeStyle } = require('../theme.js');
const Note = require('lib/models/Note.js');
const Folder = require('lib/models/Folder.js');
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

	constructor(props) {
		super(props);

		const selectedFolder = this.getSelectedFolder(this.props);
		const absences = selectedFolder ? selectedFolder.absences : undefined;
		const total_absences = selectedFolder ? selectedFolder.total_absences : undefined;
		const grades = selectedFolder ? Folder.getFullGrades(selectedFolder) : [];
		this.just_changed_absences = false;
		this.just_changed_grades = false;
		this.state = {
			selected_folder: selectedFolder,
			absences: absences,
			total_absences: total_absences,
			grades: grades,
		}
	}

	componentWillReceiveProps(newProps) {
		let selectedFolder = this.getSelectedFolder(newProps);
		const changedFolder = (this.props.selected_folder && selectedFolder.id != this.props.selected_folder.id);
		
		const absences = (changedFolder || this.just_changed_absences) ? selectedFolder.absences : this.state.absences;
		const total_absences = (changedFolder || this.just_changed_absences) ? selectedFolder.total_absences : this.state.total_absences;
		const grades = (changedFolder || this.just_changed_grades) ? Folder.getFullGrades(selectedFolder) : this.state.grades;
		this.just_changed_absences = changedFolder ? false : this.just_changed_absences;
		this.just_changed_grades = changedFolder ? false : this.just_changed_grades;

		this.setState({
			selected_folder: selectedFolder,
			absences: absences,
			total_absences: total_absences,
			grades: grades,
		});
	}

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
			titleComp = <div style={{ width: "100%" }} dangerouslySetInnerHTML={{ __html: titleElement.outerHTML }}></div>
		} else {
			titleComp = <div style={{ width: "100%" }}>{displayTitle}</div>
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
					<tbody>
						<tr>
							<th style={{ width: "100%", border: "0", padding: "0", fontWeight: "normal", fontSize: style.fontSize * 1 }}>
								{icon}
								{label}
							</th>
							{gradesLength > 0 && <th style={{ minWidth: "45px", fontAlign: "center", border: "0", paddingRight: "12px", fontWeight: "normal", fontSize: style.fontSize * 0.7 }}>Weights</th>}
							{gradesLength > 0 && <th style={{ minWidth: "46px", fontAlign: "center", border: "0", padding: "0", fontWeight: "normal", fontSize: style.fontSize * 0.7 }}>Values</th>}
							{gradesLength > 0 && <th style={{ minWidth: "30px", border: "0", padding: "0", fontWeight: "normal", fontSize: style.fontSize * 0.7 }}></th>}
						</tr>
					</tbody>
				</table>
			</div>
		);
	}

	async onChangedGradeTitle(e, grade) {
		let newTitle = e && e.target ? e.target.value : null;

		if (!newTitle) newTitle = "";
		
		// Remove $ pra n dar problema nas flags do banco
		newTitle = newTitle.replace(/\$/g, "");

		const folder = this.getSelectedFolder(this.props);
		const newGrades = Folder.getFullGrades(folder);
		for (let i = 0; i < newGrades.length; i++) {
			const g = newGrades[i];
			if (g.id == grade.id) {
				newGrades[i].title = newTitle;
				break;
			}
		}
		this.just_changed_grades = true;
		const newState = Object.assign({
			grades: newGrades,
		}, this.state);
		this.setState(newState);

		const newGradesText = Folder.getGradesText(newGrades);
		folder.grades = newGradesText;
		return await Folder.save(folder);
	}

	async onChangedGradeWeight(e, grade) {
		let newWeight = e && e.target ? e.target.value : null;
		let endedWithDot = false;
		if (!newWeight) {
			newWeight = " "; // Can't be null or ""!
		} else {
			if (newWeight.endsWith(".")) {
				newWeight = newWeight.substr(0, newWeight.length - 1);
				endedWithDot = true;
			}
			newWeight = newWeight.replace(/\,/g, "."); // Troca virgula por ponto
			newWeight = newWeight.replace(/[^0-9\.]/g, ""); // Remove tudo que não é número ou ponto			
			while ((newWeight.match(/\./g) || []).length > 1) { // Remove tudo após o segundo ponto
				newWeight = newWeight.substr(0, newWeight.lastIndexOf("."));
			}
		}
		if (endedWithDot) {
			newWeight = newWeight.concat(".");
		}
		if (newWeight.length < 1) {
			newWeight = " "; // Can't be null or ""!
		}

		const folder = this.getSelectedFolder(this.props);
		const newGrades = Folder.getFullGrades(folder);
		for (let i = 0; i < newGrades.length; i++) {
			const g = newGrades[i];
			if (g.id == grade.id) {
				newGrades[i].weight = newWeight;
				break;
			}
		}
		this.just_changed_grades = true;
		const newState = Object.assign({
			grades: newGrades,
		}, this.state);
		this.setState(newState);

		const newGradesText = Folder.getGradesText(newGrades);
		folder.grades = newGradesText;
		return await Folder.save(folder);
	}

	async onChangedGradeScore(e, grade) {
		let newScore = e && e.target ? e.target.value : null;
		let endedWithDot = false;
		if (!newScore) {
			newScore = " "; // Can't be null or ""!
		} else {
			if (newScore.endsWith(".")) {
				newScore = newScore.substr(0, newScore.length - 1);
				endedWithDot = true;
			}
			newScore = newScore.replace(/\,/g, "."); // Troca virgula por ponto
			newScore = newScore.replace(/[^0-9\.]/g, ""); // Remove tudo que não é número ou ponto			
			while ((newScore.match(/\./g) || []).length > 1) { // Remove tudo após o segundo ponto
				newScore = newScore.substr(0, newScore.lastIndexOf("."));
			}
		}
		if (endedWithDot) {
			newScore = newScore.concat(".");
		}
		if (newScore.length < 1) {
			newScore = " "; // Can't be null or ""!
		}

		const folder = this.getSelectedFolder(this.props);
		const newGrades = Folder.getFullGrades(folder);
		for (let i = 0; i < newGrades.length; i++) {
			const g = newGrades[i];
			if (g.id == grade.id) {
				newGrades[i].score = newScore;
				break;
			}
		}
		this.just_changed_grades = true;
		const newState = Object.assign({
			grades: newGrades,
		}, this.state);
		this.setState(newState);

		const newGradesText = Folder.getGradesText(newGrades);
		folder.grades = newGradesText;
		return await Folder.save(folder);
	}

	gradeRenderer(item, theme, width, isTotal) {
		let style = Object.assign({ width: width, }, this.style().listItem);
		let listItemTitleStyle = Object.assign({}, this.style().listItemTitle);

		let title = null;
		if (item.title != null) {
			if (isTotal) {
				title = <span>{item.title}</span>
			} else {
				title = <input value={this.state.grades[item.id].title} onChange={async (e) => this.onChangedGradeTitle(e, item)} style={{ width: "100%", boxSizing: "border-box", padding: "0 3px", backgroundColor: "#FFF0" }} />;
			}
		}
		let weight = item != null && item.weight != null && <input value={this.state.grades[item.id].weight} onChange={async (e) => this.onChangedGradeWeight(e, item)} style={{ width: "45px", boxSizing: "border-box", padding: "0 3px" }} />;
		let score = null;
		if (item.score != null) {
			if (isTotal) {
				score = <span>{item.score}</span>
			} else {
				score = <input value={this.state.grades[item.id].score} onChange={async (e) => this.onChangedGradeScore(e, item)} style={{ width: "45px", boxSizing: "border-box", padding: "0 3px" }} />;
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
					<tbody>
						<tr>
							<th style={{ width: "100%", border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{title}</th>
							<th style={{ border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{weight}</th>
							<th style={{ border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{score}</th>
							<th style={{ minWidth: "16px", border: "0", fontWeight: isTotal ? "bold" : "normal" }}>{addOrDelete}</th>
						</tr>
					</tbody>
				</table>
			</a>
		</div>
	}


	makeGradesSection(height) {
		const grades = this.state.grades;
		const theme = themeStyle(this.props.theme);
		const listHeight = grades.length ? grades.length * this.style().listItem.height : this.style().listItem.height;
		const gradeRenderer = (item) => { return this.gradeRenderer(item, theme, this.props.style.width, false) };

		// Calcula a media final
		let finalGradeValue = 0;
		let weightsSum = 0;
		for (let i = 0; i < grades.length; i++) {
			const element = grades[i];

			let weight = element.weight;
			if (!weight || weight == " ") weight = 0;
			else if (weight.endsWith(".")) weight = weight.substr(0, weight.length - 1); // Remove se terminar em ponto
			weight = Number(weight);

			let score = element.score;
			if (!score || score == " ") score = 0;
			else if (score.endsWith(".")) score = score.substr(0, score.length - 1); // Remove se terminar em ponto
			score = Number(score);

			finalGradeValue += weight * score;
			weightsSum += weight;
		}
		if (weightsSum <= 0) {
			finalGradeValue = 0;
		} else {
			finalGradeValue /= weightsSum;
		}

		// Cria o item que vai conter a media final
		const finalGradeItem = {
			id: "1n29e9n7129h129912e19b2en912eb97192beb912e80h1208ne",
			title: "Final grade",
			score: finalGradeValue != null ? finalGradeValue.toFixed(2) : "?",
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

	async onChangedAbsences(e) {
		let newAbsences = e.target.value;

		if (newAbsences == null) {
			newAbsences = " ";
		} else {
			newAbsences = newAbsences.replace(/[^0-9]/g, ""); // Remove tudo que não é número
			if (newAbsences == null || newAbsences.length < 1) {
				newAbsences = " ";
			} else {
				newAbsences = Number(newAbsences);
				newAbsences = Math.round(newAbsences);
				if (newAbsences < 0) newAbsences = 0;
				// const number_total_absences = Number(this.state.total_absences);
				// if (number_total_absences && newAbsences > number_total_absences) newAbsences = number_total_absences;
			}
		}

		this.just_changed_absences = true;
		const newState = Object.assign({
			absences: newAbsences,
		}, this.state);
		this.setState(newState);

		const folder = this.getSelectedFolder(this.props);
		folder.absences = newAbsences;
		return await Folder.save(folder);
	}

	async onChangedTotalAbsences(e) {
		let newTotalAbsences = e.target.value;
		let newAbsenses = this.state.absences;

		if (newTotalAbsences == null) {
			newTotalAbsences = " ";
		} else {
			newTotalAbsences = newTotalAbsences.replace(/[^0-9]/g, ""); // Remove tudo que não é número			
			if (newTotalAbsences == null || newTotalAbsences.length < 1) {
				newTotalAbsences = " ";
			} else {
				newTotalAbsences = Number(newTotalAbsences);
				newTotalAbsences = Math.round(newTotalAbsences);
				if (newTotalAbsences < 1) newTotalAbsences = 1;
				// const number_absences = Number(newAbsenses);
				// if (number_absences && number_absences > newTotalAbsences) newAbsenses = newTotalAbsences;
			}
		}

		this.just_changed_absences = true;
		const newState = Object.assign({
			total_absences: newTotalAbsences,
			absences: newAbsenses,
		}, this.state);
		this.setState(newState);

		const folder = this.getSelectedFolder(this.props);
		folder.total_absences = newTotalAbsences;
		folder.absences = newAbsenses;
		await Folder.save(folder);
	}

	absencesRenderer() {
		let abse = this.state.absences;
		let total = this.state.total_absences;
		let percentage = (isNaN(abse) || isNaN(total) || Number(total) == 0)
			? "?"
			: (100 * Number(abse) / Number(total))
		if (!isNaN(Number(percentage))) {
			if (Number(percentage) > 100) {
				percentage = ">100";
			} else if(Number(percentage) < 0) {
				percentage = "0.0";
			} else {
				percentage = Number(percentage).toFixed(1);
			}
		}

		return (
			<div>
				<label>I missed </label>
				<input value={abse} onChange={
					async (e) => this.onChangedAbsences(e)
				} style={{ width: "40px", boxSizing: "border-box", padding: "0 3px" }} />
				<label> out of </label>
				<input value={total} onChange={
					async (e) => this.onChangedTotalAbsences(e)
				} style={{ width: "40px", boxSizing: "border-box", padding: "0 3px" }} />
				<label> classes ({percentage}%) </label>
			</div>
		);
	}

	makeAbsencesSection() {
		const absencesStyle = this.style().absences;
		const message = this.absencesRenderer();

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

	getSelectedFolder(theProps) {
		let selectedFolder = this.state ? this.state.selected_folder : null;
		if (selectedFolder && selectedFolder.id == theProps.selectedFolderId) {
			// Retorna a pasta atual se ela for a mesma
			return selectedFolder;
		}
		const folders = theProps.folders;
		const selectedFolderId = theProps.selectedFolderId;
		for (let i = 0; i < folders.length; i++) {
			if (folders[i].id == selectedFolderId) {
				return folders[i];
			}
		}
		return null;
	}

	render() {
		// NOTE: This component was repurposed to render a course's partial
		// grades, absences, assignments (to-dos) and notes separated in sections.

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
				items.push(this.makeGradesSection(gradesHeight));
				items.push(this.makeAbsencesSection());
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