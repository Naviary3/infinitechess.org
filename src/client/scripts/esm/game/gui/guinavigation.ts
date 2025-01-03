
// @ts-ignore
import board from '../rendering/board.js';
// @ts-ignore
import moveutil from '../../chess/util/moveutil.js';
// @ts-ignore
import movement from '../rendering/movement.js';
// @ts-ignore
import style from './style.js';
// @ts-ignore
import input from '../input.js';
// @ts-ignore
import guipause from './guipause.js';
// @ts-ignore
import area from '../rendering/area.js';
// @ts-ignore
import transition from '../rendering/transition.js';
// @ts-ignore
import gamefileutility from '../../chess/util/gamefileutility.js';
// @ts-ignore
import statustext from './statustext.js';
// @ts-ignore
import stats from './stats.js';
// @ts-ignore
import movepiece from '../../chess/logic/movepiece.js';
// @ts-ignore
import selection from '../chess/selection.js';
// @ts-ignore
import frametracker from '../rendering/frametracker.js';
// @ts-ignore
import guigameinfo from './guigameinfo.js';
// @ts-ignore
import onlinegame from '../misc/onlinegame.js';
// @ts-ignore
import camera from '../rendering/camera.js';
import gameslot from '../chess/gameslot.js';

// @ts-ignore
// eslint-disable-next-line no-unused-vars
import type gamefile from '../../chess/logic/gamefile.js';

/**
 * This script handles the navigation bar, in a game,
 * along the top of the screen, containing the teleporation
 * buttons, rewind move, forward move, and pause buttons.
 */

const element_Navigation = document.getElementById('navigation')!;

// Navigation
const element_Recenter = document.getElementById('recenter')!;
const element_Expand = document.getElementById('expand')!;
const element_Back = document.getElementById('back')!;

const element_CoordsX = document.getElementById('x') as HTMLInputElement;
const element_CoordsY = document.getElementById('y') as HTMLInputElement;

const element_moveRewind = document.getElementById('move-left')!;
const element_moveForward = document.getElementById('move-right')!;
const element_pause = document.getElementById('pause')!;

const MAX_TELEPORT_DIST = Infinity;

const timeToHoldMillis = 250; // After holding the button this long, moves will fast-rewind
const intervalToRepeat = 40; // Default 40. How quickly moves will fast-rewind
const minimumRewindIntervalMillis = 20; // Rewinding can never be spammed faster than this
let lastRewindOrForward = 0;

let leftArrowTimeoutID: ReturnType<typeof setTimeout>; // setTimeout to BEGIN rewinding
let leftArrowIntervalID: ReturnType<typeof setTimeout>; // setInterval to CONTINUE rewinding
let touchIsInsideLeft = false;

let rightArrowTimeoutID: ReturnType<typeof setTimeout>; // setTimeout to BEGIN rewinding
let rightArrowIntervalID: ReturnType<typeof setTimeout>; // setInterval to CONTINUE rewinding
let touchIsInsideRight = false;

let rewindIsLocked = false;
const durationToLockRewindAfterMoveForwardingMillis = 750;

/** The gamefile the navigation UI was opened for. */
let activeGamefile: gamefile | undefined;

/** Whether the navigation UI is visible (not hidden) */
let navigationOpen = true;


// Functions'

function isOpen() {
	return open;
}

/** Called when we push 'N' on the keyboard */
function toggleNavigationBar() {
	// We should only ever do this if we are in a game!
	if (!activeGamefile) return;
	if (navigationOpen) close();
	else open(activeGamefile);

	navigationOpen = !navigationOpen;

	onToggleNavigationBar();
}

function onToggleNavigationBar() {
	const gamefile = gameslot.getGamefile();
	if (!gamefile) throw Error("Should not have toggled navigation bar when there's no game. The listener should have been closed.");
	if (navigationOpen) {
		open(gamefile, { allowEditCoords: !onlinegame.areInOnlineGame() });
		guigameinfo.open();
	}
	else close();

	camera.updatePIXEL_HEIGHT_OF_NAVS();
}

function open(gamefile: gamefile, { allowEditCoords = true }: { allowEditCoords?: boolean } = {}) {

	activeGamefile = gamefile;
	style.revealElement(element_Navigation);
	initListeners_Navigation();
	update_MoveButtons();
	initCoordinates({ allowEditCoords });
	navigationOpen = true;
}

function initCoordinates({ allowEditCoords }: { allowEditCoords: boolean }) {
	if (allowEditCoords) {
		element_CoordsX.disabled = false;
		element_CoordsY.disabled = false;
		element_CoordsX.classList.remove('set-cursor-to-not-allowed');
		element_CoordsY.classList.remove('set-cursor-to-not-allowed');
	} else {
		element_CoordsX.disabled = true;
		element_CoordsY.disabled = true;
		element_CoordsX.classList.add('set-cursor-to-not-allowed');
		element_CoordsY.classList.add('set-cursor-to-not-allowed');
	}
}

function close() {
	activeGamefile = undefined;
	style.hideElement(element_Navigation);
	closeListeners_Navigation();
	navigationOpen = false;
}






// Update the division on the screen displaying your current coordinates
function updateElement_Coords() {
	const boardPos = movement.getBoardPos();

	// Tile camera is over
	// element_CoordsX.textContent = Math.floor(boardPos[0] + board.gsquareCenter())
	// element_CoordsY.textContent = Math.floor(boardPos[1] + board.gsquareCenter())

	if (isCoordinateActive()) return; // Don't update the coordinates if the user is editing them

	// Tile mouse over
	element_CoordsX.value = board.gtile_MouseOver_Int() ? board.gtile_MouseOver_Int()[0] : Math.floor(boardPos[0] + board.gsquareCenter());
	element_CoordsY.value = board.gtile_MouseOver_Int() ? board.gtile_MouseOver_Int()[1] : Math.floor(boardPos[1] + board.gsquareCenter());
}

/**
 * Returns true if one of the coordinate fields is active (currently editing)
 * @returns {boolean}
 */
function isCoordinateActive() {
	return element_CoordsX === document.activeElement || element_CoordsY === document.activeElement;
}

function initListeners_Navigation() {
	element_Navigation.addEventListener("mousedown", input.doIgnoreMouseDown);
	//element_Navigation.addEventListener("mouseup", input.doIgnoreMouseDown)
	element_Navigation.addEventListener("touchstart", input.doIgnoreMouseDown);
	//element_Navigation.addEventListener("touchend", input.doIgnoreMouseDown)

	element_Recenter.addEventListener('click', callback_Recenter);
	element_Expand.addEventListener('click', callback_Expand);
	element_Back.addEventListener('click', callback_Back);
	element_moveRewind.addEventListener('click', callback_MoveRewind);
	element_moveRewind.addEventListener('mousedown', callback_MoveRewindMouseDown);
	element_moveRewind.addEventListener('mouseleave', callback_MoveRewindMouseLeave);
	element_moveRewind.addEventListener('mouseup', callback_MoveRewindMouseUp);
	element_moveRewind.addEventListener('touchstart', callback_MoveRewindTouchStart);
	element_moveRewind.addEventListener('touchmove', callback_MoveRewindTouchMove);
	element_moveRewind.addEventListener('touchend', callback_MoveRewindTouchEnd);
	element_moveRewind.addEventListener('touchcancel', callback_MoveRewindTouchEnd);
	element_moveForward.addEventListener('click', callback_MoveForward);
	element_moveForward.addEventListener('mousedown', callback_MoveForwardMouseDown);
	element_moveForward.addEventListener('mouseleave', callback_MoveForwardMouseLeave);
	element_moveForward.addEventListener('mouseup', callback_MoveForwardMouseUp);
	element_moveForward.addEventListener('touchstart', callback_MoveForwardTouchStart);
	element_moveForward.addEventListener('touchmove', callback_MoveForwardTouchMove);
	element_moveForward.addEventListener('touchend', callback_MoveForwardTouchEnd);
	element_moveForward.addEventListener('touchcancel', callback_MoveForwardTouchEnd);
	element_pause.addEventListener('click', callback_Pause);

	element_CoordsX.addEventListener('change', callback_CoordsChange);
	element_CoordsY.addEventListener('change', callback_CoordsChange);
}

function closeListeners_Navigation() {
	element_Navigation.removeEventListener("mousedown", input.doIgnoreMouseDown);
	//element_Navigation.removeEventListener("mouseup", input.doIgnoreMouseDown)
	element_Navigation.removeEventListener("touchstart", input.doIgnoreMouseDown);
	//element_Navigation.removeEventListener("touchend", input.doIgnoreMouseDown)

	element_Recenter.removeEventListener('click', callback_Recenter);
	element_Expand.removeEventListener('click', callback_Expand);
	element_Back.removeEventListener('click', callback_Back);
	element_moveRewind.removeEventListener('click', callback_MoveRewind);
	element_moveRewind.removeEventListener('mousedown', callback_MoveRewindMouseDown);
	element_moveRewind.removeEventListener('mouseleave', callback_MoveRewindMouseLeave);
	element_moveRewind.removeEventListener('mouseup', callback_MoveRewindMouseUp);
	element_moveRewind.removeEventListener('touchstart', callback_MoveRewindTouchStart);
	element_moveRewind.removeEventListener('touchmove', callback_MoveRewindTouchMove);
	element_moveRewind.removeEventListener('touchend', callback_MoveRewindTouchEnd);
	element_moveRewind.removeEventListener('touchcancel', callback_MoveRewindTouchEnd);
	element_moveForward.removeEventListener('click', callback_MoveForward);
	element_moveForward.removeEventListener('mousedown', callback_MoveForwardMouseDown);
	element_moveForward.removeEventListener('mouseleave', callback_MoveForwardMouseLeave);
	element_moveForward.removeEventListener('mouseup', callback_MoveForwardMouseUp);
	element_moveForward.removeEventListener('touchstart', callback_MoveForwardTouchStart);
	element_moveForward.removeEventListener('touchmove', callback_MoveForwardTouchMove);
	element_moveForward.removeEventListener('touchend', callback_MoveForwardTouchEnd);
	element_moveForward.removeEventListener('touchcancel', callback_MoveForwardTouchEnd);
	element_Back.removeEventListener('click', callback_Pause);

	element_CoordsX.removeEventListener('change', callback_CoordsChange);
	element_CoordsY.removeEventListener('change', callback_CoordsChange);
}

/** Is called when we hit enter after changing one of the coordinate fields */
function callback_CoordsChange() {

	if (element_CoordsX === document.activeElement) element_CoordsX.blur();
	if (element_CoordsY === document.activeElement) element_CoordsY.blur();

	const newX = Number(element_CoordsX.value);
	const newY = Number(element_CoordsY.value);
	// Make sure the teleport distance doesn't exceed the cap
	if (newX < -MAX_TELEPORT_DIST || newX > MAX_TELEPORT_DIST || newY < -MAX_TELEPORT_DIST || newY > MAX_TELEPORT_DIST) {
		statustext.showStatus(`Cannot teleport more than ${MAX_TELEPORT_DIST} squares in any direction.`, true);
		return;
	}

	movement.setBoardPos([newX, newY]);
}

function callback_Back() {
	transition.telToPrevTel();
}

function callback_Expand() {
	const allCoords = gamefileutility.getCoordsOfAllPieces(activeGamefile);
	area.initTelFromCoordsList(allCoords);
}

function callback_Recenter() {
	if (!activeGamefile) throw Error('Should not call Recenter when activeGamefile not defined.');
	recenter(activeGamefile);

}

function recenter(gamefile: gamefile) {
	const boundingBox = gamefile!.startSnapshot.box;
	if (!boundingBox) return console.error("Cannot recenter when the bounding box of the starting position is undefined!");
	area.initTelFromUnpaddedBox(boundingBox); // If you know the bounding box, you don't need a coordinate list
}

function callback_MoveRewind() {
	if (rewindIsLocked) return;
	if (!isItOkayToRewindOrForward()) return;
	lastRewindOrForward = Date.now();
	rewindMove();
}

function callback_MoveForward() {
	if (!isItOkayToRewindOrForward()) return;
	lastRewindOrForward = Date.now();
	forwardMove();
}

function isItOkayToRewindOrForward() {
	const timeSinceLastRewindOrForward = Date.now() - lastRewindOrForward;
	return timeSinceLastRewindOrForward >= minimumRewindIntervalMillis; // True if enough time has passed!
}

/**
 * Makes the rewind/forward move buttons transparent if we're at
 * the very beginning or end of the game.
 */
function update_MoveButtons() {
	const decrementingLegal = moveutil.isDecrementingLegal(activeGamefile!);
	const incrementingLegal = moveutil.isIncrementingLegal(activeGamefile!);

	if (decrementingLegal) element_moveRewind.classList.remove('opacity-0_5');
	else element_moveRewind.classList.add('opacity-0_5');

	if (incrementingLegal) element_moveForward.classList.remove('opacity-0_5');
	else element_moveForward.classList.add('opacity-0_5');
}

function callback_Pause() {
	guipause.open();
}

// Mouse

function callback_MoveRewindMouseDown() {
	leftArrowTimeoutID = setTimeout(() => {
		leftArrowIntervalID = setInterval(() => {
			callback_MoveRewind();
		}, intervalToRepeat);
	}, timeToHoldMillis);
}

function callback_MoveRewindMouseLeave() {
	clearTimeout(leftArrowTimeoutID);
	clearInterval(leftArrowIntervalID);
}

function callback_MoveRewindMouseUp() {
	clearTimeout(leftArrowTimeoutID);
	clearInterval(leftArrowIntervalID);
}

function callback_MoveForwardMouseDown() {
	rightArrowTimeoutID = setTimeout(() => {
		rightArrowIntervalID = setInterval(() => {
			callback_MoveForward();
		}, intervalToRepeat);
	}, timeToHoldMillis);
}

function callback_MoveForwardMouseLeave() {
	clearTimeout(rightArrowTimeoutID);
	clearInterval(rightArrowIntervalID);
}

function callback_MoveForwardMouseUp() {
	clearTimeout(rightArrowTimeoutID);
	clearInterval(rightArrowIntervalID);
}

// Fingers

function callback_MoveRewindTouchStart() {
	touchIsInsideLeft = true;
	leftArrowTimeoutID = setTimeout(() => {
		if (!touchIsInsideLeft) return;
		leftArrowIntervalID = setInterval(() => {
			callback_MoveRewind();
		}, intervalToRepeat);
	}, timeToHoldMillis);
}

function callback_MoveRewindTouchMove(event: TouchEvent) {
	if (!touchIsInsideLeft) return;
	const touch = event.touches[0]!;
	const rect = element_moveRewind.getBoundingClientRect();
	if (touch.clientX > rect.left &&
        touch.clientX < rect.right &&
        touch.clientY > rect.top &&
        touch.clientY < rect.bottom) return;

	touchIsInsideLeft = false;
	clearTimeout(leftArrowTimeoutID);
	clearInterval(leftArrowIntervalID);
}

function callback_MoveRewindTouchEnd() {
	touchIsInsideLeft = false;
	clearTimeout(leftArrowTimeoutID);
	clearInterval(leftArrowIntervalID);
}

function callback_MoveForwardTouchStart() {
	touchIsInsideRight = true;
	rightArrowTimeoutID = setTimeout(() => {
		if (!touchIsInsideRight) return;
		rightArrowIntervalID = setInterval(() => {
			callback_MoveForward();
		}, intervalToRepeat);
	}, timeToHoldMillis);
}

function callback_MoveForwardTouchMove(event: TouchEvent) {
	event = event || window.event;
	if (!touchIsInsideRight) return;
	const touch = event.touches[0]!;
	const rect = element_moveForward.getBoundingClientRect();
	if (touch.clientX > rect.left &&
        touch.clientX < rect.right &&
        touch.clientY > rect.top &&
        touch.clientY < rect.bottom) return;

	touchIsInsideRight = false;
	clearTimeout(rightArrowTimeoutID);
	clearInterval(rightArrowIntervalID);
}

function callback_MoveForwardTouchEnd() {
	touchIsInsideRight = false;
	clearTimeout(rightArrowTimeoutID);
	clearInterval(rightArrowIntervalID);
}

/**
 * Locks the rewind button for a brief moment. Typically called after forwarding the moves to the front.
 * This is so if our opponent moves while we're rewinding, there's a brief pause.
 */
function lockRewind() {
	rewindIsLocked = true;
	lockLayers++;
	setTimeout(() => {
		lockLayers--;
		if (lockLayers > 0) return;
		rewindIsLocked = false;
	}, durationToLockRewindAfterMoveForwardingMillis); 
}
let lockLayers = 0;

/** Tests if the arrow keys have been pressed, signaling to rewind/forward the game. */
function update() {
	testIfRewindMove();
	testIfForwardMove();
}

/** Tests if the left arrow key has been pressed, signaling to rewind the game. */
function testIfRewindMove() {
	if (!input.isKeyDown('arrowleft')) return;
	if (rewindIsLocked) return;
	rewindMove();
}

/** Tests if the right arrow key has been pressed, signaling to forward the game. */
function testIfForwardMove() {
	if (!input.isKeyDown('arrowright')) return;
	forwardMove();
}

/** Rewinds the currently-loaded gamefile by 1 move. Unselects any piece, updates the rewind/forward move buttons. */
function rewindMove() {
	if (activeGamefile!.mesh.locked) return statustext.pleaseWaitForTask();
	if (!moveutil.isDecrementingLegal(activeGamefile!)) return stats.showMoves();

	frametracker.onVisualChange();

	movepiece.rewindMove(activeGamefile!, { removeMove: false });
    
	selection.unselectPiece();

	update_MoveButtons();

	stats.showMoves();
}

/** Forwards the currently-loaded gamefile by 1 move. Unselects any piece, updates the rewind/forward move buttons. */
function forwardMove() {
	if (activeGamefile!.mesh.locked) return statustext.pleaseWaitForTask();
	if (!moveutil.isIncrementingLegal(activeGamefile!)) return stats.showMoves();

	const move = moveutil.getMoveOneForward(activeGamefile!)!;

	// Only leave animate and updateData as true
	movepiece.makeMove(activeGamefile!, move, { flipTurn: false, recordMove: false, pushClock: false, doGameOverChecks: false, updateProperties: false });

	update_MoveButtons();

	stats.showMoves();
}

/**
 * Returns true if the coords input box is currently not allowed to be edited.
 * This was set at the time they were opened.
 */
function areCoordsAllowedToBeEdited() {
	return element_CoordsX.disabled;
}

export default {
	isOpen,
	open,
	close,
	updateElement_Coords,
	update_MoveButtons,
	callback_Pause,
	lockRewind,
	update,
	isCoordinateActive,
	recenter,
	toggleNavigationBar,
	areCoordsAllowedToBeEdited,
};