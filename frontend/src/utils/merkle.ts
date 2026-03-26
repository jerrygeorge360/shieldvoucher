import { hash } from 'starknet'

const pedersenHash = hash.computePedersenHash

/**
 * Mirror of the Incremental Merkle Tree in Cairo
 * Height 20, Pedersen hashing
 */
export class ShieldMerkleTree {
    private _leaves: string[] = []
    private height: number = 20
    private filledSubtrees: string[] = []
    private nextIndex: number = 0
    private zeroHashes: string[] = []
    private _currentRoot: string = ''

    constructor() {
        this.generateZeroHashes()
        this.initializeEmptyTree()
    }

    private generateZeroHashes() {
        let current = '0x0'
        for (let i = 0; i < this.height; i++) {
            this.zeroHashes.push(current)
            current = pedersenHash(current, current)
        }
    }

    private initializeEmptyTree() {
        // Mirrors Cairo constructor: filled_subtrees[i] = current_hash; current_hash = pedersen(current_hash, current_hash)
        let currentHash = '0x0'
        for (let i = 0; i < this.height; i++) {
            this.filledSubtrees.push(currentHash)
            currentHash = pedersenHash(currentHash, currentHash)
        }
        this.nextIndex = 0
        // The empty tree root is the final currentHash after hashing through all levels
        this._currentRoot = currentHash
    }

    get leaves(): string[] {
        return this._leaves
    }

    /**
     * Incremental insertion logic mirroring Cairo _insert_into_tree exactly.
     * The root returned here is tracked and used by the `root` getter.
     */
    insert(leaf: string): string {
        this._leaves.push(leaf)
        let currentIndex = this.nextIndex
        let currentHash = leaf

        for (let i = 0; i < this.height; i++) {
            if (currentIndex % 2 === 0) {
                this.filledSubtrees[i] = currentHash
                currentHash = pedersenHash(currentHash, this.zeroHashes[i])
            } else {
                currentHash = pedersenHash(this.filledSubtrees[i], currentHash)
            }
            currentIndex = Math.floor(currentIndex / 2)
        }

        this.nextIndex++
        this._currentRoot = currentHash
        return currentHash
    }

    /**
     * Returns the current root of the tree — tracked from the last insert() call.
     * This matches the contract's incremental _insert_into_tree approach exactly.
     */
    get root(): string {
        return this._currentRoot
    }

    /**
     * Returns a Merkle proof for the given index
     */
    getProof(index: number): { proof: string[], pathIndices: number[] } {
        if (index >= this._leaves.length) throw new Error('Index out of bounds')

        const proof: string[] = []
        const pathIndices: number[] = []

        let currentLevel = [...this._leaves]
        let currentIndex = index

        for (let i = 0; i < this.height; i++) {
            const isLeft = currentIndex % 2 === 0
            pathIndices.push(isLeft ? 0 : 1)

            const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1
            const sibling = currentLevel[siblingIndex] || this.zeroHashes[i]
            proof.push(sibling)

            const nextLevel: string[] = []
            for (let j = 0; j < currentLevel.length; j += 2) {
                const left = currentLevel[j]
                const right = currentLevel[j + 1] || this.zeroHashes[i]
                nextLevel.push(pedersenHash(left, right))
            }
            currentLevel = nextLevel
            currentIndex = Math.floor(currentIndex / 2)
        }

        return { proof, pathIndices }
    }

    /**
     * Verifies a Merkle proof locally
     */
    static verifyProof(leaf: string, index: number, proof: string[], root: string): boolean {
        let currentHash = leaf
        let currentIndex = index

        for (let i = 0; i < proof.length; i++) {
            const sibling = proof[i]
            if (currentIndex % 2 === 0) {
                currentHash = pedersenHash(currentHash, sibling)
            } else {
                currentHash = pedersenHash(sibling, currentHash)
            }
            currentIndex = Math.floor(currentIndex / 2)
        }

        return currentHash === root
    }
}
