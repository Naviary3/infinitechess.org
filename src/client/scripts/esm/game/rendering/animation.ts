
/**
 * This script handles the animation of pieces.
 * It also plays the sounds.
 */

import type { Coords } from '../../chess/util/coordutil.js';
import type { Piece } from '../../chess/logic/boardchanges.js';
import type { Color } from '../../chess/util/colorutil.js';

import arrows from './arrows/arrows.js';
import gamefileutility from '../../chess/util/gamefileutility.js';
import gameslot from '../chess/gameslot.js';
import { createModel } from './buffermodel.js';
import frametracker from './frametracker.js';
import spritesheet from './spritesheet.js';
import math from '../../util/math.js';
// @ts-ignore
import bufferdata from './bufferdata.js';
// @ts-ignore
import sound from '../misc/sound.js';
// @ts-ignore
import movement from './movement.js';
// @ts-ignore
import options from './options.js';
// @ts-ignore
import board from './board.js';
// @ts-ignore
import perspective from './perspective.js';
// @ts-ignore
import shapes from './shapes.js';
import splines from '../../util/splines.js';
import coordutil from '../../chess/util/coordutil.js';


// Type Definitions -----------------------------------------------------------------------


/** Represents an animation segment between two waypoints. */
interface AnimationSegment {
	start: Coords;
	end: Coords;
	distance: number;
}

/** Represents an animation of a piece. */
interface Animation {
	/** The type of piece to animate. */
	type: string;
	/** The waypoints the piece will pass throughout the animation. Minimum: 2 */
	path: Coords[];
	/** The segments between each waypoint */
	segments: AnimationSegment[];
	/** The piece captured, if one was captured. This will be rendered in place for the during of the animation. */
	captured?: Piece;
	/** The time the animation started. */
	startTimeMillis: number;
	/** The duration of the animation. */
	durationMillis: number;
	/** The total distance the piece will travel throughout the animation across all waypoints. */
	totalDistance: number;
	/** Whether the sound has been played yet. */
	soundPlayed: boolean;
	/** The id of the timeout that will play the sound a little before the animation finishes, so there isn't a delay. */
	soundTimeoutId?: ReturnType<typeof setTimeout>;
	/** The id of the timeout that will remove the animation from the list once it's over. */
	scheduledRemovalId?: ReturnType<typeof setTimeout>;	
}


// Constants -------------------------------------------------------------------


/** If this is enabled, the spline of the animation will be rendered, and the animations duration increased. */
const DEBUG = false;
/** Config for the splines. */
const SPLINES: {
	/** The number of points per segment of the spline. */
	RESOLUTION: number;
	/** The thickness of the spline. Used when debug rendering. */
	WIDTH: number;
	/** The color of the spline. Used when debug rendering. */
	COLOR: [number, number, number, number];
} = {
	RESOLUTION: 10, // Default: 10
	WIDTH: 0.15, // Default: 0.15
	COLOR: [1, 0, 0, 1] // Default: [1, 0, 0, 1]
};

/**
 * The z offset of the transparent square meant to block out the default
 * rendering of the pieces while the animation is visible.
 * 
 * THIS MUST BE GREATER THAN THE Z AT WHICH PIECES ARE RENDERED.
 */
const TRANSPARENT_SQUARE_Z: number = 0.01;
/** By adding a negative offset, the sound doesn't appear delayed. */
const SOUND_OFFSET: number = -100;
/** The maximum distance an animation can be without teleporting mid-animation. */
const MAX_DISTANCE_BEFORE_TELEPORT: number = 80; // 80

/** Used for calculating the duration of move animations. */
const MOVE_ANIMATION_DURATION = {
	/** The base amount of duration, in millis. */
	baseMillis: DEBUG ? 1000 : 150, // Default: 150
	/** The multiplier amount of duration, in millis, multiplied by the capped move distance. */
	multiplierMillis: DEBUG ? 30 : 6,
	/** The multiplierMillis when there's atleast 3+ waypoints */
	multiplierMillis_Curved: DEBUG ? 60 : 12, // Default: 12
};


// Variables -------------------------------------------------------------------------------


/** The list of all current animations */
const animations: Animation[] = [];


// Adding / Clearing Animations -----------------------------------------------------------------------


/**
 * Animates a piece after moving it.
 * @param type - The type of piece to animate
 * @param path - The waypoints the piece will pass throughout the animation. Minimum: 2
 * @param captured - The piece captured, if one was captured. This will be rendered in place for the during of the animation.
 * @param resetAnimations - If false, allows animation of multiple pieces at once. Useful for castling. Default: true
 */
function animatePiece(type: string, path: Coords[], captured?: Piece, resetAnimations: boolean = true): void {
	if (path.length < 2) throw new Error("Animation requires at least 2 waypoints");
	if (resetAnimations) clearAnimations(true);

	// Generate smooth spline waypoints
	const path_HighResolution = splines.generateSplinePath(path, SPLINES.RESOLUTION);
	const segments = createAnimationSegments(path_HighResolution);
	const totalDistance = calculateTotalAnimationDistance(segments);

	const newAnimation: Animation = {
		type,
		path: path_HighResolution,
		segments,
		captured,
		startTimeMillis: performance.now(),
		durationMillis: calculateAnimationDuration(totalDistance, path_HighResolution.length),
		totalDistance,
		soundPlayed: false
	};

	scheduleSoundPlayback(newAnimation);
	scheduleAnimationRemoval(newAnimation);
	animations.push(newAnimation);
}

/**
 * Terminates all animations.
 * 
 * Should be called when we're skipping through moves quickly
 * (in that scenario we immediately play the sound),
 * or when the game is unloaded.
 */
function clearAnimations(playSounds = false): void {
	animations.forEach(animation => {
		clearTimeout(animation.soundTimeoutId); // Don't play it twice..
		clearTimeout(animation.scheduledRemovalId); // Don't remove it twice..
		if (playSounds && !animation.soundPlayed) playAnimationSound(animation, true); // .. play it NOW.
	});
	animations.length = 0; // Empties existing animations
}


// Helper Functions -----------------------------------------------------------


/** Creates the segments between each waypoint. */
function createAnimationSegments(waypoints: Coords[]): AnimationSegment[] {
	const segments: AnimationSegment[] = [];
	for (let i = 0; i < waypoints.length - 1; i++) {
		const start = waypoints[i]!;
		const end = waypoints[i + 1]!;
		segments.push({
			start,
			end,
			distance: math.euclideanDistance(start, end)
		});
	}
	return segments;
}

/** Calculates the total length of the path traveled by the piece in the animation. */
function calculateTotalAnimationDistance(segments: AnimationSegment[]): number {
	return segments.reduce((sum, seg) => sum + seg.distance, 0);
}

/** Calculates the duration in milliseconds a particular move would take to animate. */
function calculateAnimationDuration(totalDistance: number, waypointCount: number): number {
	const cappedDist = Math.min(totalDistance, MAX_DISTANCE_BEFORE_TELEPORT);
	const multiplierToUse = waypointCount > 2 ? MOVE_ANIMATION_DURATION.multiplierMillis_Curved : MOVE_ANIMATION_DURATION.multiplierMillis;
	const additionMillis = cappedDist * multiplierToUse;
	return MOVE_ANIMATION_DURATION.baseMillis + additionMillis;
}

/** Schedules the playback of the sound of the animation. */
function scheduleSoundPlayback(animation: Animation): void {
	const playbackTime = Math.max(0, animation.durationMillis + SOUND_OFFSET);
	animation.soundTimeoutId = setTimeout(() => playAnimationSound(animation, false), playbackTime);
}

/** Schedules the removal of an animation after it's over. */
function scheduleAnimationRemoval(animation: Animation) {
	animation.scheduledRemovalId = setTimeout(() => {
		const index = animations.indexOf(animation);
		if (index === -1) return; // Already removed
		animations.splice(index, 1);
		frametracker.onVisualChange();
	}, animation.durationMillis);
}

/**
 * Plays the sound of the animation.
 * @param animation - The animation to play the sound for.
 * @param dampen - Whether to dampen the sound. This should be true if we're skipping through moves quickly.
 */
function playAnimationSound(animation: Animation, dampen: boolean) {
	if (animation.captured !== undefined) sound.playSound_capture(animation.totalDistance, dampen);
	else sound.playSound_move(animation.totalDistance, dampen);
	animation.soundPlayed = true;
}


// Updating -------------------------------------------------------------------------------


/** Flags the frame to be rendered if there are any animations, and adds an arrow indicator animation for each */
function update() {
	if (animations.length === 0) return;

	frametracker.onVisualChange();
	animations.forEach(animation => shiftArrowIndicatorOfAnimatedPiece(animation) ); // Animate the arrow indicator
}

/** Animates the arrow indicator */
function shiftArrowIndicatorOfAnimatedPiece(animation: Animation) {
	const animationCurrentCoords = getCurrentAnimationPosition(animation);
	const piece = gamefileutility.getPieceAtCoords(gameslot.getGamefile()!, animation.path[animation.path.length - 1]!)!;
	arrows.shiftArrow(piece, animationCurrentCoords, animation.captured);
}


// Rendering -------------------------------------------------------------------------------


/**
 * Renders the transparent squares that block out the default rendering of the pieces while the animation is visible.
 * This works because they are higher in the depth buffer than the pieces.
 */
function renderTransparentSquares(): void {
	if (!animations.length) return;

	const color: Color = [0, 0, 0, 0];
	// Calls map() on each animation, and then flats() the results into a single array.
	const data = animations.flatMap(animation => 
		shapes.getTransformedDataQuad_Color_FromCoord(
			animation.path[animation.path.length - 1], 
			color
		)
	);

	createModel(data, 2, "TRIANGLES", true)
		.render([0, 0, TRANSPARENT_SQUARE_Z]);
}

/** Renders the animations of the pieces. */
function renderAnimations() {
	if (animations.length === 0) return;

	if (DEBUG) animations.forEach(animation => splines.renderSplineDebug(animation.path, SPLINES.WIDTH, SPLINES.COLOR));

	// Calls map() on each animation, and then flats() the results into a single array.
	const data = animations.flatMap(animation => {
		const currentPos = getCurrentAnimationPosition(animation);
		const piecesData: number[] = [];
		if (animation.captured !== undefined) piecesData.push(...generatePieceData(animation.captured.type, animation.captured.coords)); // Render the captured piece
		piecesData.push(...generatePieceData(animation.type, currentPos)); // Render the moving piece
		return piecesData;
	});

	createModel(data, 2, "TRIANGLES", true, spritesheet.getSpritesheet())
		.render();
}

/**
 * Adds the vertex data of the piece of an animation to the data array. 
 * @param data - The running list of data to append to.
 * @param type - The type of piece the data and animation is for.
 * @param coords - The coordinates of the piece of the animation.
*/
function generatePieceData(type: string, coords: Coords): number[] {
	const rotation = perspective.getIsViewingBlackPerspective() ? -1 : 1;
	const { texleft, texbottom, texright, textop } = bufferdata.getTexDataOfType(type, rotation);
	const { startX, startY, endX, endY } = calculateBoardPosition(coords);
	const { r, g, b, a } = options.getColorOfType(type);
    
	return bufferdata.getDataQuad_ColorTexture(
		startX, startY, endX, endY,
		texleft, texbottom, texright, textop,
		r, g, b, a
	);
}

/** Calculates the position of a piece on the board from its coordinates. */
function calculateBoardPosition(coords: Coords) {
	const boardPos = movement.getBoardPos();
	const boardScale = movement.getBoardScale();
	const squareCenter = board.gsquareCenter();
	const startX = (coords[0] - boardPos[0] - squareCenter) * boardScale;
	const startY = (coords[1] - boardPos[1] - squareCenter) * boardScale;
	return {
		startX,
		startY,
		endX: startX + 1 * boardScale,
		endY: startY + 1 * boardScale
	};
}


// Animation Calculations -----------------------------------------------------


/** Returns the coordinate the animation's piece should be rendered this frame. */
function getCurrentAnimationPosition(animation: Animation): Coords {
	const elapsed = performance.now() - animation.startTimeMillis;
	/** Range 0 to 1, representing the progress of the animation. */
	const progress = Math.min(elapsed / animation.durationMillis, 1);
	/** The eased progress of the animation. */
	const eased = easeInOut(progress);

	return calculateInterpolatedPosition(animation, eased);
}

/** Returns the coordinate the animation's piece should be rendered at a certain eased progress. */
function calculateInterpolatedPosition(animation: Animation, easedProgress: number): Coords {
	const targetDistance = animation.totalDistance <= MAX_DISTANCE_BEFORE_TELEPORT ? easedProgress * animation.totalDistance : calculateTeleportDistance(animation.totalDistance, easedProgress);
	return findPositionInSegments(animation.segments, targetDistance);
}

/** Calculates the distance the piece animation should be rendered along the path, when the total distance is great enough to merit teleporting. */
function calculateTeleportDistance(totalDistance: number, easedProgress: number): number {
	// First half
	if (easedProgress < 0.5) return easedProgress * 2 * (MAX_DISTANCE_BEFORE_TELEPORT / 2);
	// Second half: animate final portion of path
	const portionFromEnd = (easedProgress - 0.5) * 2 * (MAX_DISTANCE_BEFORE_TELEPORT / 2);
	return (totalDistance - MAX_DISTANCE_BEFORE_TELEPORT / 2) + portionFromEnd;
}

/** Finds the position of the piece at a certain distance along the path. */
function findPositionInSegments(segments: AnimationSegment[], targetDistance: number): Coords {
	let accumulated = 0;
	for (const segment of segments) {
		if (targetDistance <= accumulated + segment.distance) {
			const segmentProgress = (targetDistance - accumulated) / segment.distance;
			return coordutil.lerpCoords(segment.start, segment.end, segmentProgress);
		}
		accumulated += segment.distance;
	}
	return segments[segments.length - 1]!.end;
}


// Utility Functions ----------------------------------------------------------


/**
 * Applies an ease-in-out function to the progress value.
 * @param progress - The linear progress value (between 0 and 1).
 */
function easeInOut(progress: number): number {
	return -0.5 * Math.cos(Math.PI * progress) + 0.5;
}


// -----------------------------------------------------------------------------------------


export default {
	animatePiece,
	clearAnimations,
	update,
	renderTransparentSquares,
	renderAnimations,
};