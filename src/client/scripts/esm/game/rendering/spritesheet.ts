
/**
 * This script stores the spritesheet FOR THE CURRENT GAME,
 * and all the piece's texture coordinates within it.
 * 
 * If no game is loaded, no spritesheet is loaded.
 */

import { generateSpritesheet } from '../../chess/rendering/spritesheetGenerator.js';
import { convertSVGsToImages } from '../../chess/rendering/svgtoimageconverter.js';
import typeutil from '../../chess/util/typeutil.js';
import svgcache from '../../chess/rendering/svgcache.js';
// @ts-ignore
import texture from './texture.js';
import { rawTypes } from '../../chess/config.js';

// Type Definitions ----------------------------------------------------------


// @ts-ignore
import type gamefile from '../../chess/logic/gamefile.js';
import type { Coords } from '../../chess/logic/movesets.js';


// Variables ---------------------------------------------------------------------------


/**
 * The spritesheet texture for rendering the pieces of the current game.
 * 
 * Using a spritesheet instead of 1 texture for each piece allows us to
 * render all the pieces with a single mesh, and a single texture.
 */
let spritesheet: WebGLTexture | undefined; // Texture. Grid containing every texture of every piece, black and white.
/**
 * Contains where each piece is located in the spritesheet (texture coord).
 * Texture coords of a piece range from 0-1, where (0,0) is the bottom-left corner.
 */
let spritesheetData: {
	/** The width of each texture in the whole spritesheet, as a fraction. */
	pieceWidth: number,
	/**
	 * The texture locations of each piece type in the spritesheet,
	 * where (0,0) is the bottom-left corner of the spritesheet,
	 * and the coordinates provided are the bottom-left corner of the corresponding type.
	 */
	texLocs: { [type: number]: Coords
	 }
} | undefined;

/** Piece types that don't have an SVG */
const typesWithoutSVG = [rawTypes.VOID];


// Functions ---------------------------------------------------------------------------


function getSpritesheet() {
	if (!spritesheet) throw new Error("Should not be getting the spritesheet when not loaded!");
	return spritesheet!;
}

function getSpritesheetDataPieceWidth() {
	if (!spritesheetData) throw new Error("Should not be getting piece width when the spritesheet is not loaded!");
	return spritesheetData!.pieceWidth;
}

function getSpritesheetDataTexLocation(type: number): Coords {
	if (!spritesheetData) throw new Error("Should not be getting texture locations when the spritesheet is not loaded!");
	return spritesheetData!.texLocs[type]!;
}

/** Loads the spritesheet texture we'll be using to render the provided gamefile's pieces */
async function initSpritesheetForGame(gl: WebGL2RenderingContext, gamefile: gamefile) {

	const types = [...gamefile.ourPieces.typeRanges.keys()].filter(t => {return typeutil.getRawType(t) in typesWithoutSVG;});

	/**
	 * The SVG elements we will use in the game to construct our spritesheet
	 * This is what may take a while, waiting for the fetch requests to return.
	 */
	const [idMap, svgElements] = await svgcache.getSVGElements(types);

	// console.log("Finished acquiring all piece SVGs!");

	// Convert each SVG element to an Image
	const readyImages: HTMLImageElement[] = await convertSVGsToImages(svgElements);

	const spritesheetAndSpritesheetData = await generateSpritesheet(gl, readyImages, idMap);
	// console.log(spritesheetAndSpritesheetData.spritesheetData);

	// Optional: Append the spritesheet to the document for debugging
	// spritesheetAndSpritesheetData.spritesheet.style.display = 'none';
	// document.body.appendChild(spritesheetAndSpritesheetData.spritesheet);

	// Load the texture into webgl and initiate our spritesheet
	// data that contains the texture coordinates of each piece!
	spritesheet = texture.loadTexture(gl, spritesheetAndSpritesheetData.spritesheet, { useMipmaps: true });
	spritesheetData = spritesheetAndSpritesheetData.spritesheetData;
}

function deleteSpritesheet() {
	spritesheet = undefined;
	spritesheetData = undefined;
}



export default {
	typesWithoutSVG,
	initSpritesheetForGame,
	getSpritesheet,
	getSpritesheetDataPieceWidth,
	getSpritesheetDataTexLocation,
	deleteSpritesheet,
};