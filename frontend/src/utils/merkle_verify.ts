import { ShieldMerkleTree } from './merkle'

function test() {
    const tree = new ShieldMerkleTree()
    console.log('Empty Root:', tree.root)

    console.log('\nInserting leaf 1 (0x123)...')
    const root1 = tree.insert('0x123')
    console.log('Root after 1 insertion:', root1)
    console.log('tree.root property:', tree.root)

    console.log('\nInserting leaf 2 (0x456)...')
    const root2 = tree.insert('0x456')
    console.log('Root after 2 insertions:', root2)
    console.log('tree.root property:', tree.root)

    console.log('\nGenerating Proof for leaf 0 (0x123):')
    const { proof, pathIndices } = tree.getProof(0)
    console.log('Proof:', proof)
    console.log('Path Indices:', pathIndices)

    const isValid = ShieldMerkleTree.verifyProof('0x123', 0, proof, tree.root)
    console.log('Proof is valid:', isValid)
}

test()
