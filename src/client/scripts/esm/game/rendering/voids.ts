
/**
 * This generates and renders the mesh of the void squares
 * in the game.
 */


import type { Coords } from '../../chess/util/coordutil.js';
import type { Color } from '../../chess/util/colorutil.js';
import type { Piece } from '../../chess/logic/boardchanges.js';
// @ts-ignore
import type { gamefile } from '../../chess/logic/gamefile.js';


import { createModel_Instanced } from './buffermodel.js';
import coordutil from '../../chess/util/coordutil.js';
import gameslot from '../chess/gameslot.js';
import instancedshapes from './instancedshapes.js';
// @ts-ignore
import movement from './movement.js';


// Variables ----------------------------------------------------------------------------------------


const STRIDE_PER_PIECE = 2; // Instance data contains a stride of 2 (x,y)

/** The color of all voids */
const color: Color = [0, 0, 0, 1];


// Generating and Shifting the Mesh -------------------------------------------------------------------


/**
 * Completely regenerates the model of the voids in the game.
 * SLOWEST. Minimize calling.
 * Must be called whenever we add more undefineds placeholders to the voids piece list.
 */
function regenModel(gamefile: gamefile) {
	/** A list of coordinates of all voids in the gamefile */
	const voidList = gameslot.getGamefile()!.ourPieces.voidsN;
	if (!voidList) return; // No voids are present in this game

	const vertexData: number[] = instancedshapes.getDataLegalMoveSquare(color);
	const instanceData64: Float64Array = new Float64Array(voidList.length * STRIDE_PER_PIECE); // Initialize with all 0's

	let currIndex: number = 0;
	voidList.forEach((coords: Coords | undefined) => {
		if (coords === undefined) {
			// Undefined placeholder, this one should not be visible. If we leave it at 0, then there's a visible void at [0,0]
			instanceData64[currIndex] = Infinity;
			instanceData64[currIndex + 1] = Infinity;
		} else {
			// Apply the piece mesh offset to the coordinates
			instanceData64[currIndex] = coords[0] - gamefile.mesh.offset[0];
			instanceData64[currIndex + 1] = coords[1] - gamefile.mesh.offset[1];
		}
		currIndex += STRIDE_PER_PIECE;
	});

	gamefile.voidMesh.instanceData64 = instanceData64;
	gamefile.voidMesh.model = createModel_Instanced(vertexData, new Float32Array(instanceData64), 'TRIANGLES', true);
}

/**
 * Shifts the vertex data of the voids model and reinits it on the gpu.
 * Faster than {@link regenModel}
 * @param gamefile - The gamefile
 * @param diffXOffset - The x-amount to shift the voids vertex data
 * @param diffYOffset - The y-amount to shift the voids vertex data
 */
function shiftModel(gamefile: gamefile, diffXOffset: number, diffYOffset: number): void {
	if (gamefile.voidMesh.model === undefined) return;
	
	const instanceData64 = gamefile.voidMesh.instanceData64; // High precision floats for performing calculations
	const instanceData32 = gamefile.voidMesh.model.instanceData; // Low precision floats for sending to the gpu
	for (let i = 0; i < instanceData32.length; i += STRIDE_PER_PIECE) {
		instanceData64[i] += diffXOffset;
		instanceData64[i + 1] += diffYOffset;
		// Copy the float32 values from the float64 array so as to gain the most precision
		instanceData32[i] = instanceData64[i];
		instanceData32[i + 1] = instanceData64[i + 1];
	}
	
	// Update the buffer on the gpu!
	gamefile.voidMesh.model.updateBufferIndices_InstanceBuffer(0, instanceData64.length); // Update every index
}


// Modifying the Mesh Data ----------------------------------------------------------------------



/**
 * Overwrites the instance data of the specified void within the
 * void mesh with the new coordinates of the instance.
 * Then sends that change off to the gpu.
 * 
 * FAST, much faster than regenerating or shifting the entire mesh!
 */
function overwritebufferdata(gamefile: gamefile, piece: { index: number, coords: Coords }) {
	const i = piece.index * STRIDE_PER_PIECE;

	const offsetCoord = coordutil.subtractCoordinates(piece.coords, gamefile.mesh.offset);

	gamefile.voidMesh.instanceData64[i] = offsetCoord[0];
	gamefile.voidMesh.instanceData64[i + 1] = offsetCoord[1];
	gamefile.voidMesh.model.instanceData[i] = offsetCoord[0];
	gamefile.voidMesh.model.instanceData[i + 1] = offsetCoord[1];

	// Update the buffer on the gpu!
	gamefile.voidMesh.model.updateBufferIndices_InstanceBuffer(i, STRIDE_PER_PIECE);
}

/**
 * Deletes the instance data of the specified void within the void mesh
 * by overwriting it with Infinity's, then sends that change off to the gpu.
 * FAST, much faster than regenerating or shifting the entire mesh!
 */
function deletebufferdata(gamefile: gamefile, piece: { index: number }) {
	const i = piece.index * STRIDE_PER_PIECE;

	gamefile.voidMesh.instanceData64[i] = Infinity; // Unfortunately we can't set them to 0 to hide it, as an actual void instance would be visible at [0,0]
	gamefile.voidMesh.instanceData64[i + 1] = Infinity;
	gamefile.voidMesh.model.instanceData[i] = Infinity;
	gamefile.voidMesh.model.instanceData[i + 1] = Infinity;

	// Update the buffer on the gpu!
	gamefile.voidMesh.model.updateBufferIndices_InstanceBuffer(i, STRIDE_PER_PIECE);
}


// Rendering ----------------------------------------------------------------------------------------


/**
 * Renders the void mesh of the game, translating and scaling into position.
 */
function render(gamefile: gamefile) {
	if (gamefile.voidMesh.model === undefined) return;

	const boardPos = movement.getBoardPos();
	const position: [number,number,number] = [ // Translate
        -boardPos[0] + gamefile.mesh.offset[0], // Add the model's offset. 
        -boardPos[1] + gamefile.mesh.offset[1],
        0
    ]; // While separate these are each big decimals, TOGETHER they are small number! That's fast for rendering!
	const boardScale = movement.getBoardScale();
	const scale: [number,number,number] = [boardScale, boardScale, 1];

	gamefile.voidMesh.model.render(position, scale);
}


// Export --------------------------------------------------------------------------------------------


export default {
	regenModel,
	shiftModel,
	overwritebufferdata,
	deletebufferdata,
	render,
};