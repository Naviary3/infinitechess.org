
/**
 * This module keeps trap of the data of the onlinegame we are currently in.
 * */


import type { DisconnectInfo, DrawOfferInfo, OnlineGameParticipantState, OnlineGameSpectatorInfoState, ServerGameParticipantInfo, ServerGameStaticProperties } from './onlinegamerouter.js';
import type { Player } from '../../../chess/util/typeutil.js';
import type { ClockValues } from '../../../chess/logic/clock.js';

import localstorage from '../../../util/localstorage.js';
import gamefileutility from '../../../chess/util/gamefileutility.js';
import typeutil from '../../../chess/util/typeutil.js';
import gameslot from '../../chess/gameslot.js';
import afk from './afk.js';
import tabnameflash from './tabnameflash.js';
import disconnect from './disconnect.js';
import serverrestart from './serverrestart.js';
import drawoffers from './drawoffers.js';
import moveutil from '../../../chess/util/moveutil.js';
import pingManager from '../../../util/pingManager.js';
// @ts-ignore
import websocket from '../../websocket.js';


// Variables ------------------------------------------------------------------------------------------------------


/** Whether or not we are currently in an online game. */
let inOnlineGame: boolean = false;

/** The id of the online game we are in, if we are in one. */
let id: number | undefined;

/**
 * Whether the game is a private one (joined from an invite code).
 */
let isPrivate: boolean | undefined;

/**
 * Whether the game is rated.
 */
let rated: boolean | undefined;

/**
 * The color we are in the online game, if we are in it.
 */
let ourColor: Player | undefined;

/**
 * Different from gamefile.gameConclusion, because this is only true if {@link gamefileutility.concludeGame}
 * has been called, which IS ONLY called once the SERVER tells us the result of the game, not us!
 */
let serverHasConcludedGame: boolean | undefined;

/**
 * Whether we are in sync with the game on the server.
 * If false, we do not submit our move. (move will be auto-submitted upon resyncing)
 * Set to false whenever we lose connection, or the socket closes.
 * Set to true whenever we join game, or successfully resync.
 * 
 * If we aren't subbed to a game, then it's automatically assumed we are out of sync.
 */
let inSync: boolean | undefined;


// Getters --------------------------------------------------------------------------------------------------------------


function areInOnlineGame(): boolean {
	return inOnlineGame;
}

/** Returns the game id of the online game we're in.  */
function getGameID(): number {
	if (!inOnlineGame) throw Error("Cannot get id of online game when we're not in an online game.");
	return id!;
}

function getIsPrivate(): boolean {
	if (!inOnlineGame) throw Error("Cannot get isPrivate of online game when we're not in an online game.");
	return isPrivate!;
}

function isRated(): boolean {
	if (!inOnlineGame) throw Error("Cannot ask if online game is rated when we're not in one.");
	return rated!;
}

/** Returns whether we are one of the players in the online game. */
function doWeHaveRole(): boolean {
	if (!inOnlineGame) throw Error("Cannot ask if we have a role in online game when we're not in an online game.");
	return ourColor !== undefined;
}

function getOurColor(): Player | undefined {
	if (!inOnlineGame) throw Error("Cannot get color we are in online game when we're not in an online game.");
	return ourColor; 
}

function areWeColorInOnlineGame(color: Player): boolean {
	if (!inOnlineGame) return false; // Can't be that color, because we aren't even in a game.
	return ourColor === color;
}

function isItOurTurn(): boolean {
	if (!inOnlineGame) throw Error("Cannot get isItOurTurn of online game when we're not in an online game.");
	return gameslot.getGamefile()!.whosTurn === ourColor;
}

function areInSync(): boolean {
	if (!inOnlineGame) throw Error("Cannot get inSync of online game when we're not in an online game.");
	return inSync!;
}

/**
 * Different from {@link gamefileutility.isGameOver}, because this only returns true if {@link gamefileutility.concludeGame}
 * has been called, which IS ONLY called once the SERVER tells us the result of the game, not us!
 */
function hasServerConcludedGame(): boolean {
	if (!inOnlineGame) throw Error("Cannot get serverHasConcludedGame of online game when we're not in an online game.");
	return serverHasConcludedGame!;
}

function setInSyncTrue() {
	inSync = true;
}

function setInSyncFalse() {
	if (!inOnlineGame) return;
	inSync = false;
}


// Functions ------------------------------------------------------------------------------------------------------


function initOnlineGame(options: {
	/** Required game information. */
	gameInfo: ServerGameStaticProperties,
	/** Defined if you have a role (are a player) in the game. */
	participantInfo?: ServerGameParticipantInfo,
	spectatorInfoState: OnlineGameSpectatorInfoState,
}) {
	inOnlineGame = true;
	inSync = true;

	id = options.gameInfo.id;
	isPrivate = options.gameInfo.publicity === 'private';
	rated = options.gameInfo.rated;

	ourColor = options.participantInfo?.youAreColor;
	
	if (options.participantInfo) set_DrawOffers_DisconnectInfo_AutoAFKResign_ServerRestarting(options.participantInfo.state, options.spectatorInfoState);

	afk.onGameStart();
	tabnameflash.onGameStart({ isOurMove: isItOurTurn() });

	serverHasConcludedGame = false;

	initEventListeners();
}

function set_DrawOffers_DisconnectInfo_AutoAFKResign_ServerRestarting(participantInfoState: OnlineGameParticipantState, spectatorInfoState: OnlineGameSpectatorInfoState) {
	if (participantInfoState.drawOffer) drawoffers.set(participantInfoState.drawOffer);

	// If opponent is currently disconnected, display that countdown
	if (participantInfoState.disconnect) disconnect.startOpponentDisconnectCountdown(participantInfoState.disconnect);
	else disconnect.stopOpponentDisconnectCountdown();

	// If Opponent is currently afk, display that countdown
	if (participantInfoState.millisUntilAutoAFKResign !== undefined) afk.startOpponentAFKCountdown(participantInfoState.millisUntilAutoAFKResign);
	else afk.stopOpponentAFKCountdown();

	// If the server is restarting, start displaying that info.
	if (spectatorInfoState.serverRestartingAt !== undefined) serverrestart.initServerRestart(spectatorInfoState.serverRestartingAt);
	else serverrestart.resetServerRestarting();
}

// Call when we leave an online game
function closeOnlineGame() {
	inOnlineGame = false;
	id = undefined;
	isPrivate = undefined;
	rated = undefined;
	ourColor = undefined;
	inSync = undefined;
	serverHasConcludedGame = undefined;
	afk.onGameClose();
	tabnameflash.onGameClose();
	serverrestart.onGameClose();
	drawoffers.onGameClose();
	closeEventListeners();
}

function initEventListeners() {
	// Add the event listeners for when we lose connection or the socket closes,
	// to set our inSync variable to false
	document.addEventListener('connection-lost', setInSyncFalse); // Custom event
	document.addEventListener('socket-closed', setInSyncFalse); // Custom event

	/**
	 * Leave-game warning popups on every hyperlink.
	 * 
	 * Add an listener for every single hyperlink on the page that will
	 * confirm to us if we actually want to leave if we are in an online game.
	 */
	document.querySelectorAll('a').forEach((link) => {
		link.addEventListener('click', confirmNavigationAwayFromGame);
	});
}

function closeEventListeners() {
	document.removeEventListener('connection-lost', setInSyncFalse);
	document.removeEventListener('socket-closed', setInSyncFalse);
	document.querySelectorAll('a').forEach((link) => {
		link.removeEventListener('click', confirmNavigationAwayFromGame);
	});
}

/**
 * Confirm that the user DOES actually want to leave the page if they are in an online game.
 * 
 * Sometimes they could leave by accident, or even hit the "Logout" button by accident,
 * which just ejects them out of the game
 * @param event 
 */
function confirmNavigationAwayFromGame(event: MouseEvent) {
	// Check if Command (Meta) or Ctrl key is held down
	if (event.metaKey || event.ctrlKey) return; // Allow opening in a new tab without confirmation
	if (gamefileutility.isGameOver(gameslot.getGamefile()!)) return;

	const userConfirmed = confirm('Are you sure you want to leave the game?'); 
	if (userConfirmed) return; // Follow link like normal. Server then starts a 20-second auto-resign timer for disconnecting on purpose.
	// Cancel the following of the link.
	event.preventDefault();

	/*
	 * KEEP IN MIND that if we leave the pop-up open for 10 seconds,
	 * JavaScript is frozen in that timeframe, which means as
	 * far as the server can tell we're not communicating anymore,
	 * so it automatically closes our websocket connection,
	 * thinking we've disconnected, and starts a 60-second auto-resign timer.
	 * 
	 * As soon as we hit cancel, we are communicating again.
	 */
}

function update() {
	afk.updateAFK();
}

/**
 * Requests a game update from the server, since we are out of sync.
 */
function resyncToGame() {
	if (!inOnlineGame) throw Error("Don't call resyncToGame() if not in an online game.");
	inSync = false;
	websocket.sendmessage('game', 'resync', id!);
}

function onMovePlayed({ isOpponents }: { isOpponents: boolean}) {
	// Inform all the scripts that rely on online game
	// logic that a move occurred, so they can update accordingly
	afk.onMovePlayed({ isOpponents });
	tabnameflash.onMovePlayed({ isOpponents });
	drawoffers.onMovePlayed({ isOpponents });
}

function reportOpponentsMove(reason: string) {
	// Send the move number of the opponents move so that there's no mixup of which move we claim is illegal.
	const opponentsMoveNumber = gameslot.getGamefile()!.moves.length + 1;

	const message = {
		reason,
		opponentsMoveNumber
	};

	websocket.sendmessage('game', 'report', message);
}



// Aborts / Resigns
function onMainMenuPress() {
	if (!inOnlineGame) return;
	
	// Tell the server we no longer want game updates.
	// Just resigning isn't enough for the server
	// to deduce we don't want future game updates.
	websocket.unsubFromSub('game');
	
	if (serverHasConcludedGame) return; // Don't need to abort/resign, game is already over

	const gamefile = gameslot.getGamefile()!;
	if (moveutil.isGameResignable(gamefile)) websocket.sendmessage('game','resign');
	else 									 websocket.sendmessage('game','abort');
}



/** Called when an online game is concluded (termination shown on-screen) */
function onGameConclude() {
	if (!inOnlineGame) return; // The game concluded wasn't an online game.

	serverHasConcludedGame = true; // This NEEDS to be above drawoffers.onGameClose(), as that relies on this!
	afk.onGameClose();
	tabnameflash.onGameClose();
	serverrestart.onGameClose();
	deleteCustomVariantOptions();
	drawoffers.onGameClose();
	requestRemovalFromPlayersInActiveGames();
}

function deleteCustomVariantOptions() {
	// Delete any custom pasted position in a private game.
	if (isPrivate) localstorage.deleteItem(String(id!));
}

/**
 * Lets the server know we have seen the game conclusion, and would
 * like to be allowed to join a new game if we leave quickly.
 * 
 * THIS SHOULD ALSO be the point when the server knows we agree
 * with the resulting game conclusion (no cheating detected),
 * and the server may change the players elos!
 */
function requestRemovalFromPlayersInActiveGames() {
	if (!areInOnlineGame()) return;
	websocket.sendmessage('game', 'removefromplayersinactivegames');
}

/**
 * Modifies the clock values to account for ping.
 */
function adjustClockValuesForPing(clockValues: ClockValues): ClockValues {
	if (!clockValues.colorTicking) return clockValues; // No clock is ticking (< 2 moves, or game is over), don't adjust for ping

	// Ping is round-trip time (RTT), So divided by two to get the approximate
	// time that has elapsed since the server sent us the correct clock values
	const halfPing = pingManager.getHalfPing();
	if (halfPing > 2500) console.error("Ping is above 5000 milliseconds!!! This is a lot to adjust the clock values!");
	// console.log(`Ping is ${halfPing * 2}. Subtracted ${halfPing} millis from ${clockValues.colorTicking}'s clock.`);

	if (clockValues.clocks[clockValues.colorTicking] === undefined) throw Error(`Invalid color "${clockValues.colorTicking}" to modify clock value to account for ping.`);
	clockValues.clocks[clockValues.colorTicking]! -= halfPing;

	// Flag what time the player who's clock is ticking will lose on time.
	// Do this because while while the gamefile is being constructed, the time left may become innacurate.
	clockValues.timeColorTickingLosesAt = Date.now() + clockValues.clocks[clockValues.colorTicking]!;

	return clockValues;
}

/**
 * Returns the key that's put in local storage to store the variant options
 * of the current online game, if we have pasted a position in a private match.
 */
function getKeyForOnlineGameVariantOptions(gameID: number) {
	return `online-game-variant-options${gameID}`;
}

export default {
	onmessage,
	getGameID,
	getIsPrivate,
	isRated,
	doWeHaveRole,
	getOurColor,
	setInSyncTrue,
	initOnlineGame,
	set_DrawOffers_DisconnectInfo_AutoAFKResign_ServerRestarting,
	closeOnlineGame,
	isItOurTurn,
	areInSync,
	onMainMenuPress,
	resyncToGame,
	update,
	onGameConclude,
	hasServerConcludedGame,
	reportOpponentsMove,
	onMovePlayed,
	areInOnlineGame,
	areWeColorInOnlineGame,
	adjustClockValuesForPing,
	getKeyForOnlineGameVariantOptions,
};
