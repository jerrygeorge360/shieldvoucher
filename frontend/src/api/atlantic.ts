/**
 * Herodotus Atlantic API Client
 * Official Spec: https://atlantic.api.herodotus.cloud/docs
 */

const ATLANTIC_BASE_URL = 'https://atlantic.api.herodotus.cloud';

export type AtlanticJobStatus = 'RECEIVED' | 'IN_PROGRESS' | 'DONE' | 'FAILED';

export interface ProofGenerationRequest {
    programSierra: string; // Base64 encoded Sierra string
    args: (string | number)[]; // Flat array of arguments for the circuit
}

/**
 * Submits a proof generation job to Atlantic using multipart/form-data.
 */
export async function submitProofJob(data: ProofGenerationRequest): Promise<{ jobId: string }> {
    const apiKey = import.meta.env.VITE_ATLANTIC_API_KEY;
    if (!apiKey) throw new Error('VITE_ATLANTIC_API_KEY not set');

    const formData = new FormData();

    // 1. Program File (Sierra JSON)
    const programBinary = atob(data.programSierra);
    const programBuffer = new Uint8Array(programBinary.length);
    for (let i = 0; i < programBinary.length; i++) {
        programBuffer[i] = programBinary.charCodeAt(i);
    }
    const programBlob = new Blob([programBuffer], { type: 'application/json' });
    formData.append('programFile', programBlob, 'circuit.sierra.json');

    // DEBUG: Verify Sierra file content
    const debugText = await programBlob.text();
    console.log('PROGRAM_FILE_SIZE:', debugText.length);
    console.log('PROGRAM_FILE_PREVIEW:', debugText.slice(0, 300));
    try {
        const parsed = JSON.parse(debugText);
        console.log('PROGRAM_FILE_KEYS:', Object.keys(parsed));
    } catch (e) {
        console.error('PROGRAM_FILE_IS_NOT_VALID_JSON:', e);
    }

    // 2. Input File: Rust VM format - space-separated values in brackets
    // Per docs: "text file containing an input array, e.g. [1 [2 3 4]]"
    // See: https://docs.herodotus.cloud/atlantic-api/steps/trace-generation
    console.debug('ATLANTIC_DIAG: Submitting with args:', data.args);
    // Convert all values to decimal format (no 0x prefix)
    const decimalArgs = data.args.map(a => {
        const s = a.toString();
        if (s.startsWith('0x') || s.startsWith('0X')) {
            return BigInt(s).toString(10);
        }
        return s;
    });
    // Rust VM format: [val1 val2 val3 ...] — space-separated, NOT comma-separated JSON
    const inputContent = '[' + decimalArgs.join(' ') + ']';
    console.log('INPUT_FILE_CONTENT:', inputContent);
    const inputBlob = new Blob([inputContent], { type: 'text/plain' });
    formData.append('inputFile', inputBlob, 'input.cairo1.txt');

    // 3. Metadata (matching official Atlantic example format)
    formData.append('layout', 'auto');
    formData.append('cairoVm', 'rust');
    formData.append('cairoVersion', 'cairo1');
    formData.append('result', 'PROOF_VERIFICATION_ON_L2');
    formData.append('declaredJobSize', 'S');
    formData.append('mockFactHash', 'false');

    const response = await fetch(`${ATLANTIC_BASE_URL}/atlantic-query?apiKey=${apiKey}`, {
        method: 'POST',
        body: formData // Fetch handles multipart headers automatically
    });

    if (!response.ok) {
        const errorBody = await response.text();
        let errorMessage = errorBody;
        try {
            // FIX 7: Surface structured JSON error messages
            const parsed = JSON.parse(errorBody);
            errorMessage = parsed.message || errorBody;
        } catch { }
        throw new Error(`Atlantic API error ${response.status}: ${errorMessage}`);
    }

    const result = await response.json();
    // FIX 6: Robust jobId extraction
    if (!result.atlanticQueryId) {
        throw new Error(`Atlantic response missing atlanticQueryId. Full response: ${JSON.stringify(result)}`);
    }
    return { jobId: result.atlanticQueryId };
}

/**
 * Fetches the current status of an Atlantic job.
 */
export async function getJobStatus(jobId: string): Promise<{ status: AtlanticJobStatus; step?: string; errorReason?: string }> {
    const apiKey = import.meta.env.VITE_ATLANTIC_API_KEY;
    const url = `${ATLANTIC_BASE_URL}/atlantic-query/${jobId}?apiKey=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Atlantic API status error: ${response.status}`);
    }

    const data = await response.json();
    console.log('ATLANTIC_STATUS_RESPONSE:', JSON.stringify(data)); 
    const query = data.atlanticQuery || data;
    return {
        status: query.status || data.status,
        step: query.step,
        errorReason: query.errorReason
    };
}

/**
 * Polls for job completion until it reaches a final state or timeouts.
 */
export async function waitForJob(
    jobId: string,
    onStatusUpdate?: (status: AtlanticJobStatus) => void,
    intervalMs: number = 15000,
    timeoutMs: number = 900000 // 15 mins for L2 verification (trace + proof + on-chain)
): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const { status, step, errorReason } = await getJobStatus(jobId);
        if (onStatusUpdate) onStatusUpdate(status);

        if (status === 'DONE') return;
        if (status === 'FAILED') {
            const details = [
                step ? `step: ${step}` : null,
                errorReason ? `reason: ${errorReason}` : 'reason: circuit assertion failed (check inputs)'
            ].filter(Boolean).join(', ');
            throw new Error(`Atlantic job failed (${details})`);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Atlantic job timed out');
}
