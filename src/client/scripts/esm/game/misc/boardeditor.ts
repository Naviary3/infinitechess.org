
// src/client/scripts/esm/game/misc/boardeditor.ts

/*
 * This script handles the Board Editor logic
 */


import boardchanges from '../../chess/logic/boardchanges.js';
import gameslot from '../chess/gameslot.js';
import coordutil from '../../chess/util/coordutil.js';
import icnconverter, { _Move_Compact } from '../../chess/logic/icn/icnconverter.js';
import docutil from '../../util/docutil.js';
import selection from '../chess/selection.js';
import state from '../../chess/logic/state.js';
import boardutil from '../../chess/util/boardutil.js';
import specialrighthighlights from '../rendering/highlights/specialrighthighlights.js';
import { Mouse } from '../input.js';
import guiboardeditor from '../gui/guiboardeditor.js';
import { players, rawTypes } from '../../chess/util/typeutil.js';
import mouse from '../../util/mouse.js';
import movesequence from '../chess/movesequence.js';
import annotations from '../rendering/highlights/annotations/annotations.js';
import movepiece from '../../chess/logic/movepiece.js';
import guinavigation from '../gui/guinavigation.js';
// @ts-ignore
import statustext from '../gui/statustext.js';

// Type Definitions -------------------------------------------------------------

import type { Coords } from '../../chess/util/coordutil.js';
import type { Edit } from '../../chess/logic/movepiece.js';
import type { Piece } from '../../chess/util/boardutil.js';
import type { Mesh } from '../rendering/piecemodels.js';
import type { Player } from '../../chess/util/typeutil.js';
import type { Board, FullGame } from '../../chess/logic/gamefile.js';


type Tool = (typeof validTools)[number];


// Variables --------------------------------------------------------------------

/** All tools that can be used in the board editor. */
const validTools = ["normal", "placer", "eraser", "selector", "gamerules", "specialrights"] as const;
/** All tools that support drawing. */
const drawingTools: Tool[] = ["placer", "eraser", "specialrights"];

/** Whether we are currently using the editor. */
let inBoardEditor = false;

let currentColor: Player = players.WHITE;
let currentPieceType: number = rawTypes.VOID;
let currentTool: Tool = "normal";


/**
 * Changes are stored in `thisEdit` until the user releases the button.
 * Grouping changes together allow the user to undo an entire
 * brush stroke at once instead of one piece at a time.
 */
let thisEdit: Edit | undefined;
/** The list of all edits the user has made. */
let edits: Array<Edit> | undefined;
let indexOfThisEdit: number | undefined = 0;

let drawing = false;
let previousSquare: Coords | undefined;
/** Whether special rights are currently being added or removed with the current drawing stroke. Undefined if neither. */
let addingSpecialRights: boolean | undefined;


// Functions ------------------------------------------------------------------------

function initBoardEditor() {
	inBoardEditor = true;
	edits = [];
	indexOfThisEdit = 0;

	setTool("normal");
	setColor(players.WHITE);
	setPiece(rawTypes.VOID);

	guiboardeditor.markTool(currentTool);
	guiboardeditor.updatePieceColors(currentColor);
	guiboardeditor.markPiece(currentPieceType);
}

function closeBoardEditor() {
	inBoardEditor = false;
	drawing = false;
	addingSpecialRights = undefined;
	thisEdit = undefined;
	edits = undefined;
	indexOfThisEdit = undefined;
	previousSquare = undefined;
}

function areInBoardEditor() {
	return inBoardEditor;
}

/** Set the piece type to be added to the board */
function setPiece(pieceType: number) {
	currentPieceType = pieceType;
}

function getPiece() {
	return currentPieceType;
}

function setColor(color: Player) {
	currentColor = color;
}

function getColor() {
	return currentColor;
}

/** Change the tool being used. */
function setTool(tool: string) {
	if (!validTools.includes(tool as Tool)) return;
	currentTool = tool as Tool;
	endEdit();

	// Prevents you from being able to draw while a piece is selected.
	if (drawingTools.includes(currentTool)) selection.unselectPiece();

	if (tool === "specialrights") specialrighthighlights.enable();
	else specialrighthighlights.disable();

	guiboardeditor.markTool(tool);
	if (tool !== "placer") guiboardeditor.markPiece(null);
	else guiboardeditor.markPiece(currentPieceType);
}

function getTool() {
	return currentTool;
}

function isBoardEditorUsingDrawingTool() {
	return inBoardEditor && drawingTools.includes(currentTool);
}

function canUndo() {
	// comparing undefined always returns false
	return indexOfThisEdit! > 0;
}

function canRedo() {
	// comparing undefined always returns false
	return indexOfThisEdit! < edits?.length!;
}

function beginEdit() {
	drawing = true;
	thisEdit = { changes:[], state: {local: [], global: []} };
	// Pieces must be unselected before they are modified
	selection.unselectPiece();
}

function endEdit() {
	drawing = false;
	addingSpecialRights = undefined;
	previousSquare = undefined;
	if (thisEdit !== undefined) addEditToHistory(thisEdit);
	thisEdit = undefined;
}

/** Runs both logical and graphical changes. */
function runEdit(gamefile: FullGame, mesh: Mesh, edit: Edit, forward: boolean = true) {
	// Pieces must be unselected before they are modified
	selection.unselectPiece();

	// Run logical changes
	movepiece.applyEdit(gamefile, edit, forward, true); // Apply the logical changes to the board state

	// Run graphical changes
	movesequence.runMeshChanges(gamefile.boardsim, mesh, edit, forward);

	specialrighthighlights.onMove();
}

function addEditToHistory(edit: Edit) {
	if (edit.changes.length === 0 && edit.state.local.length === 0 && edit.state.global.length === 0) return;
	edits!.length = indexOfThisEdit!;
	edits!.push(edit);
	indexOfThisEdit!++;
	guinavigation.update_EditButtons();
}

function update(): void {
	if (!inBoardEditor) return;

	// Handle starting and ending the drawing state
	if (drawingTools.includes(currentTool)) {
		if (mouse.isMouseDown(Mouse.LEFT) && !drawing) {
			mouse.claimMouseDown(Mouse.LEFT); // Remove the pointer down so other scripts don't use it
			beginEdit();
		}
		else if (!mouse.isMouseHeld(Mouse.LEFT) && drawing) return endEdit();
	}

	// If not drawing, or if the current tool doesn't support drawing, there's nothing more to do
	if (!drawing || !drawingTools.includes(currentTool)) return;

	const gamefile = gameslot.getGamefile()!;
	const mesh = gameslot.getMesh()!;
	const coords = mouse.getTileMouseOver_Integer();
	if (coords === undefined) return;
	if (previousSquare !== undefined && coordutil.areCoordsEqual(coords, previousSquare)) return;
	previousSquare = coords;

	const pieceHovered = boardutil.getPieceFromCoords(gamefile.boardsim.pieces, coords);
	const edit: Edit = { changes: [], state: { local: [], global: [] } };

	switch (currentTool) {
		case "placer":
			queueAddPiece(gamefile, edit, pieceHovered, coords, currentPieceType);
			break;
		case "eraser":
			queueRemovePiece(gamefile, edit, pieceHovered);
			break;
		case "specialrights":
			queueToggleSpecialRight(gamefile, edit, pieceHovered);
			break;
		default:
			break;
	}

	if (edit.changes.length === 0 && edit.state.local.length === 0 && edit.state.global.length === 0) return;
	runEdit(gamefile, mesh, edit, true);
	thisEdit!.changes.push(...edit.changes);
	thisEdit!.state.local.push(...edit.state.local);
	thisEdit!.state.global.push(...edit.state.global);
}

function queueToggleSpecialRight(gamefile: FullGame, edit: Edit, pieceHovered: Piece | undefined) {
	if (pieceHovered === undefined) return;
	const coordsKey = coordutil.getKeyFromCoords(pieceHovered.coords);
	const current = gamefile.boardsim.state.global.specialRights.has(coordsKey);
	const future = !current;

	if (addingSpecialRights === undefined) addingSpecialRights = future;
	else if (addingSpecialRights !== future) return;

	state.createSpecialRightsState(edit, coordsKey, current, future);
}

function queueAddPiece(gamefile: FullGame, edit: Edit, pieceHovered: Piece | undefined, coords: Coords, type: number) {
	if (pieceHovered?.type === type) return; // do not do anything if new piece would be equal to old piece
	if (pieceHovered !== undefined) queueRemovePiece(gamefile, edit, pieceHovered);
	const piece: Piece = { type, coords, index:-1 };
	boardchanges.queueAddPiece(edit.changes, piece);
}

function queueRemovePiece(gamefile: FullGame, edit: Edit, pieceHovered: Piece | undefined) {
	if (!pieceHovered) return;
	const coordsKey = coordutil.getKeyFromCoords(pieceHovered.coords);
	// Remove the piece
	boardchanges.queueDeletePiece(edit.changes, false, pieceHovered);
	// Remove its special right
	const current = gamefile.boardsim.state.global.specialRights.has(coordsKey);
	state.createSpecialRightsState(edit, coordutil.getKeyFromCoords(pieceHovered.coords), current, false);
	// If the pawn has been removed, the en passant square must be too.
	if (gamefile.boardsim.state.global.enpassant?.square !== undefined && coordutil.areCoordsEqual(pieceHovered.coords, gamefile.boardsim.state.global.enpassant.square)) {
		state.createEnPassantState(edit, gamefile.boardsim.state.global.enpassant, undefined);
	}
}

function clearAll() {
	if (!inBoardEditor) throw Error("Cannot clear board when we're not using the board editor.");
	const gamefile = gameslot.getGamefile()!;
	const mesh = gameslot.getMesh()!;
	const pieces = gamefile.boardsim.pieces;
	const edit: Edit = { changes: [], state: { local: [], global: [] } };
	for (const idx of pieces.coords.values()) {
		const pieceToDelete = boardutil.getPieceFromIdx(pieces, idx);
		queueRemovePiece(gamefile, edit, pieceToDelete);
	};
	runEdit(gamefile, mesh, edit, true);
	addEditToHistory(edit);
	annotations.onGameUnload(); // Clear all annotations, as when a game is unloaded
}

function undo() {
	if (!inBoardEditor) throw Error("Cannot undo edit when we're not using the board editor.");
	if (indexOfThisEdit! <= 0) return;
	const gamefile = gameslot.getGamefile()!;
	const mesh = gameslot.getMesh()!;
	indexOfThisEdit!--;
	runEdit(gamefile, mesh, edits![indexOfThisEdit!]!, false);
	guinavigation.update_EditButtons();
}

function redo() {
	if (!inBoardEditor) throw Error("Cannot redo edit when we're not using the board editor.");
	if (indexOfThisEdit! >= edits!.length) return;
	const gamefile = gameslot.getGamefile()!;
	const mesh = gameslot.getMesh()!;
	runEdit(gamefile, mesh, edits![indexOfThisEdit!]!, true);
	indexOfThisEdit!++;
	guinavigation.update_EditButtons();
}

/**
 * copypastegame uses the move list instead of the position
 * which doesn't work for the board editor.
 * This function uses the position of pieces on the board.
 */
function save() {
	const gamefile = gameslot.getGamefile();
	if (!gamefile) return;
	const pieces = gamefile.boardsim.pieces;
	let output = "";
	pieces.coords.forEach((idx: number, coordsKey: string) => {
		const type = pieces.types[idx];
		if (type !== undefined) output += icnconverter.getAbbrFromType(type) + coordsKey + '|';
	});
	docutil.copyToClipboard(output.slice(0,-1));
	statustext.showStatus(translations['copypaste']['copied_game']);
}

function load() {
	// Need to implement position loading and also fix pasting logic
	statustext.showStatus("Loading not yet implemented", true);
}


/**
 * Similar to {@link movesequence.makeMove}, but doesn't push the move to the game's
 * moves list, nor update gui, clocks, or do game over checks, nor the moveIndex property updated.
 */
function makeMoveEdit(gamefile: FullGame, mesh: Mesh | undefined, moveDraft: _Move_Compact): Edit {
	const edit = generateMoveEdit(gamefile.boardsim, moveDraft);

	movepiece.applyEdit(gamefile, edit, true, true); // forward & global are always true
	if (mesh) movesequence.runMeshChanges(gamefile.boardsim, mesh, edit, true);

	addEditToHistory(edit);

	return edit;
}

/**
 * Similar to {@link movepiece.generateMove}, but specifically for editor moves,
 * which don't execute special moves, nor are appeneded to the game's moves list,
 * nor the gamefile's moveIndex property updated.
 */
function generateMoveEdit(boardsim: Board, moveDraft: _Move_Compact): Edit {
	const piece = boardutil.getPieceFromCoords(boardsim.pieces, moveDraft.startCoords);
	if (!piece) throw Error(`Cannot generate move edit because no piece exists at coords ${JSON.stringify(moveDraft.startCoords)}.`);

	// Initialize the state, and change list, as empty for now.
	const edit: Edit = {
		changes: [],
		state: { local: [], global: [] },
	};
	
	movepiece.calcMovesChanges(boardsim, piece, moveDraft, edit); // Move piece regularly (no specials)
	
	// Queue the state change transfer of this edit's special right to its new destination.
	const startCoordsKey = coordutil.getKeyFromCoords(moveDraft.startCoords);
	const endCoordsKey = coordutil.getKeyFromCoords(moveDraft.endCoords);
	const hasSpecialRight = boardsim.state.global.specialRights.has(startCoordsKey);
	const destinationHasSpecialRight = boardsim.state.global.specialRights.has(endCoordsKey);
	state.createSpecialRightsState(edit, startCoordsKey, hasSpecialRight, false); // Delete the special right from the startCoords, if it exists
	state.createSpecialRightsState(edit, endCoordsKey, destinationHasSpecialRight, hasSpecialRight); // Transfer the special right to the endCoords, if it exists
	
	return edit;
}

export type {
	Edit
};

export default {
	areInBoardEditor,
	initBoardEditor,
	closeBoardEditor,
	setPiece,
	getPiece,
	setColor,
	getColor,
	setTool,
	getTool,
	isBoardEditorUsingDrawingTool,
	update,
	canUndo,
	canRedo,
	undo,
	redo,
	save,
	load,
	clearAll,
	makeMoveEdit,
};