import dotenv from 'dotenv'
import chai, { assert } from "chai"
import chaiAsPromised from "chai-as-promised"
import {
    checkParticipantForCeremony,
    createS3Bucket,
    extractPrefix,
    getBucketName,
    getCeremonyCircuits,
    getCurrentFirebaseAuthUser,
    getDocumentById,
    getNewOAuthTokenUsingGithubDeviceFlow,
    getNextCircuitForContribution,
    getOpenedCeremonies,
    multiPartUpload,
    signInToFirebaseWithGithubToken,
    getCircuitMetadataFromR1csFile,
    estimatePoT,
    downloadFileFromUrl,
    objectExist,
    setupCeremony,
    getFileStats,
    getClosedCeremonies,
    checkAndPrepareCoordinatorForFinalization,
    formatZkeyIndex,
    writeLocalJsonFile,
    finalizeLastContribution,
    finalizeCeremony
} from '../src/index'
import path from "path"
import { 
    deleteAdminApp, 
    initializeAdminServices, 
    initializeUserServices, 
    sleep,
    r1csFilePath, 
    r1csFileName
} from "./utils"
import { collections, names, potFilenameTemplate } from "../src/helpers/constants"
import { createCeremony, deleteCeremony } from './utils'
import { fakeCeremoniesData, fakeCircuitsData } from './data/samples'
import { randomBytes} from "crypto"
import { zKey, r1cs } from "snarkjs"
import { CeremonyInputData, Circuit, CircuitFiles, CircuitTimings } from 'types'
import blake from "blakejs"
import { FirebaseApp } from 'firebase/app'
import { Firestore } from 'firebase/firestore'
import { Functions } from 'firebase/functions'
import crypto from "crypto"


/**
 * Flow for user that wants to contribute to a ceremony
 * @param userApp 
 * @param userFirestore 
 * @param userFunctions 
 */
const userFlow = async (userApp: FirebaseApp, userFirestore: Firestore, userFunctions: Functions) => {
    const user = getCurrentFirebaseAuthUser(userApp)
    expect(user).toBeDefined
    
    const ceremonies = await getOpenedCeremonies(userFirestore)
    expect(ceremonies.length).toBeGreaterThan(0)

    const ceremony = ceremonies.at(0)
    expect(ceremony?.id).toBeDefined

    const circuits = await getCeremonyCircuits(userFirestore, ceremony?.id!)
    expect(circuits.length).toBeGreaterThan(0)
    
    // call can participate
    const canParticipate = await checkParticipantForCeremony(userFunctions, ceremony?.id!)
    expect(canParticipate).toBeTruthy

    const participantDoc = await getDocumentById(
        userFirestore,
        `${collections.ceremonies}/${ceremony?.id}/${collections.participants}`,
        user.uid
    )

    // Get updated data from snap.
    const participantData = participantDoc.data()
    expect(participantData).toBeDefined
}


jest.setTimeout(50000000)

const convertToDoubleDigits = (amount: number): string => (amount < 10 ? `0${amount}` : amount.toString())

// Config chai.
chai.use(chaiAsPromised)
dotenv.config({ path: path.join(__dirname, '../.env.test')})
const cwd = process.cwd()

describe("E2E", () => {
    if (
        !process.env.GITHUB_CLIENT_ID ||
        !process.env.CONFIG_CEREMONY_BUCKET_POSTFIX
    ) throw new Error("Not configured correctly")

    const { adminFirestore } = initializeAdminServices()
    const { userApp, userFirestore, userFunctions } = initializeUserServices()

    describe("Auth and Contribute", () => {
        beforeEach(async () => {
            // mock creating a ceremony
            await createCeremony(adminFirestore)
        })

        it('contributor authenticates and lists available ceremonies', async () => {
            // get the token 
            // this step requires to actually do the device flow 
            // need to find a way to do that automatically
            const token = await getNewOAuthTokenUsingGithubDeviceFlow(
                String(process.env.GITHUB_CLIENT_ID)
            )

            await signInToFirebaseWithGithubToken(userApp, token)
            
            // list all ceremonies
            const ceremonies = await getOpenedCeremonies(userFirestore)
            // confirm that we have at least 1
            expect(ceremonies.length).toBeGreaterThan(0)
        }) 

        it('contibutor authenticates and lists all available ceremonies, then submits entropy for one of them', async () => {
            // auth 
            // @todo 
            // Get current authenticated user.
            await userFlow(userApp, userFirestore, userFunctions)

            // entropy
            // const entropyOrBeacon = new Uint8Array(256).map(() => Math.random() * 256).toString()
        })

        it('tries to participate in a ceremony but times out, the user is unable to contribute again to the same one', async () => {
            await userFlow(userApp, userFirestore, userFunctions)
        })

        it('the contributor is locked out but they manage to contribute to another ceremony instead', async () => {})
        it('generates a transcript for the contribution. The queue is updated accordingly', async () => {})
        it('contributes and checks the gist with the contribution summary', async () => {})
        
        afterEach(async () => {
            // clean up 
            await deleteCeremony(adminFirestore)
            await deleteAdminApp()
        })
    })  

    describe.only('Setup', () => {
        it('fails to setup a new ceremony due to some error with files required for the ceremony', async () => {
            // 1. Auth
            const token = await getNewOAuthTokenUsingGithubDeviceFlow(
                String(process.env.GITHUB_CLIENT_ID)
            )

            await signInToFirebaseWithGithubToken(userApp, token)

            // 2. Mock data extraction
            const circuit = fakeCircuitsData.fakeCircuitSmallNoContributors

            const zkeyStoragePath = `${collections.circuits}/${circuit.data.prefix}/${collections.contributions}`
            const firstZkeyFileName = `${circuit.data.prefix}_00000.zkey`
            const zkeyStorageFilePath = `${zkeyStoragePath}/${firstZkeyFileName}`

            // 3. create s3 bucket
            const ceremonyPrefix = randomBytes(20).toString('hex')
            const bucketName = getBucketName(ceremonyPrefix, process.env.CONFIG_CEREMONY_BUCKET_POSTFIX!)
            const success = await createS3Bucket(userFunctions, bucketName)
            expect(success).toBeTruthy

            await sleep(1000)

            // 4. Upload fail
            assert.isRejected(multiPartUpload(
                userFunctions,
                bucketName,
                zkeyStorageFilePath,
                zkeyStoragePath,
                process.env.CONFIG_STREAM_CHUNK_SIZE_IN_MB || "50",
                Number(process.env.CONFIG_PRESIGNED_URL_EXPIRATION_IN_SECONDS) || 7200
            ))
        })
        it.only('successfully setups a new ceremony', async () => {
            // 1. Auth 
            // @todo 
             // 1. Auth
             const token = await getNewOAuthTokenUsingGithubDeviceFlow(
                String(process.env.GITHUB_CLIENT_ID)
            )

            await signInToFirebaseWithGithubToken(userApp, token)

            // 2. Circuit data extraction
            // we use the division circuit
            const title = randomBytes(20).toString('hex')
            const description = "Disivion test e2e ceremony"
            const startDate = fakeCeremoniesData.fakeCeremonyScheduledFixed.data.startDate
            const endDate = fakeCeremoniesData.fakeCeremonyScheduledFixed.data.endDate
            const compilerVersion = fakeCircuitsData.fakeCircuitSmallNoContributors.data.compiler.version
            const compilerHash = fakeCircuitsData.fakeCircuitSmallNoContributors.data.compiler.commitHash
            const circuitName = "division"
            const circuitPrefix = extractPrefix(circuitName)

            const circuitMetadata = await r1cs.info(r1csFilePath)
            const curve = circuitMetadata.curve.name
            const labels = circuitMetadata.nLabels
            const constraints = circuitMetadata.nConstraints
            const publicInputs = circuitMetadata.nPubInputs
            const privateInputs = circuitMetadata.nPrvInputs
            const outputs = circuitMetadata.nOutputs
            const wires = circuitMetadata.nVars

            const pot = estimatePoT(constraints, outputs)
            const stringifyNeededPowers = convertToDoubleDigits(pot)
            const smallestPotForCircuit = `${potFilenameTemplate}${stringifyNeededPowers}.ptau`  

            const potStoragePath = `./${names.pot}`
            const potStorageFilePath = `${potStoragePath}/${smallestPotForCircuit}`

            const r1csStoragePath = `${collections.circuits}/${circuitPrefix}`
            const zkeyStoragePath = `${collections.circuits}/${circuitPrefix}/${collections.contributions}`
            const r1csStorageFilePath = `${r1csStoragePath}/division.r1cs`

            // // generate random name so that it doesn't fail creating a new one
            const ceremonyPrefix = randomBytes(20).toString('hex')
            const bucketName = getBucketName(ceremonyPrefix, process.env.CONFIG_CEREMONY_BUCKET_POSTFIX!)
            
            const zkeyPath = `./${circuitName}_0001.zkey`
            const firstZkeyFileName = `${circuitPrefix}_00000.zkey`
            const zkeyStorageFilePath = `${zkeyStoragePath}/${firstZkeyFileName}`

            // Compute first .zkey file (without any contribution).
            await zKey.newZKey(
                r1csFilePath,
                smallestPotForCircuit,
                zkeyPath,
                console
            )

            // // 3. create s3 bucket
            const success = await createS3Bucket(userFunctions, bucketName)
            expect(success).toBeTruthy

            await sleep(1000)

            // // 4. Upload

            // Upload PoT
            await multiPartUpload(
                userFunctions,
                bucketName,
                potStorageFilePath,
                `./${smallestPotForCircuit}`,
                process.env.CONFIG_STREAM_CHUNK_SIZE_IN_MB || "50",
                Number(process.env.CONFIG_PRESIGNED_URL_EXPIRATION_IN_SECONDS) || 7200
            )

            // Upload R1CS.
            await multiPartUpload(
                userFunctions,
                bucketName,
                r1csStorageFilePath,
                r1csFilePath,
                process.env.CONFIG_STREAM_CHUNK_SIZE_IN_MB || "50",
                Number(process.env.CONFIG_PRESIGNED_URL_EXPIRATION_IN_SECONDS) || 7200
            )
            
            // Upload zkey.
            await multiPartUpload(
                userFunctions,
                bucketName,
                zkeyStorageFilePath,
                zkeyPath,
                process.env.CONFIG_STREAM_CHUNK_SIZE_IN_MB || "50",
                Number(process.env.CONFIG_PRESIGNED_URL_EXPIRATION_IN_SECONDS) || 7200
            )
            
            // config properly circuit obj
            // Circuit-related files info.
            const circuitFiles: CircuitFiles = {
                files: {
                    r1csFilename: r1csFileName,
                    potFilename: smallestPotForCircuit,
                    initialZkeyFilename: firstZkeyFileName,
                    r1csStoragePath: r1csStorageFilePath,
                    potStoragePath: potStorageFilePath,
                    initialZkeyStoragePath: zkeyStorageFilePath,
                    r1csBlake2bHash: blake.blake2bHex(r1csStorageFilePath),
                    potBlake2bHash: blake.blake2bHex(potStorageFilePath),
                    initialZkeyBlake2bHash: blake.blake2bHex(zkeyStorageFilePath)
                }
            }
            const circuitTimings: CircuitTimings = {
                avgTimings: {
                    contributionComputation: 0,
                    fullContribution: 0,
                    verifyCloudFunction: 0
                }
            }

            const zkeySizeInBytes = getFileStats(firstZkeyFileName).size

            const circuits: Circuit[] = [          
                    {
                        description: description,
                        compiler: {
                            commitHash: compilerHash,
                            version: compilerVersion
                        },
                        template: {
                            source: "https://test.com/division.circom",
                            commitHash: compilerHash,
                            paramsConfiguration: []
                        },
                        metadata: {
                            curve,
                            wires,
                            constraints,
                            privateInputs,
                            publicOutputs: publicInputs,
                            labels,
                            outputs,
                            pot
                        },
                        ...circuitFiles,
                        ...circuitTimings,
                        zKeySizeInBytes: zkeySizeInBytes
                    },
                    
                
            ]

            const ceremonyInputData: CeremonyInputData = {
                title: title,
                description: description,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                timeoutMechanismType: 2,
                penalty: 1
            }
            // setup ceremony
            await setupCeremony(userFunctions, ceremonyInputData, ceremonyPrefix, circuits)

        })
    })

    describe('Finalize', () => {
        it('successfully finalizes a ceremony', async () => {
            // 1. auth as coordinator 

            // 2. list closed ceremonies
            const closedCeremoniesDocs = await getClosedCeremonies(userFirestore)
            expect(closedCeremoniesDocs.length).toBeGreaterThan(0)

            // 3. pick one of the ceremonies to finalize
            const ceremony = closedCeremoniesDocs.at(0)!
            expect(ceremony).toBeDefined

            // 4. check if it is possible to finalize this one ceremony
            const { data: canFinalize } = await checkAndPrepareCoordinatorForFinalization(userFunctions, ceremony?.id)
            expect(canFinalize).toBeTruthy

            // 5. entropy generation 
            const beacon = randomBytes(20).toString('hex')
            const beaconString = crypto.createHash("sha256").update(beacon).digest("hex")

            // 6. Get the circuits
            const circuits = await getCeremonyCircuits(userFirestore, ceremony.id)
            expect(circuits.length).toBeGreaterThan(0)

            // 7. make last contribution
            for (const circuit of circuits) {
                // make contribution
                // await makeContribution(ceremony, circuit, beaconHashStr, username, true, firebaseFunctions)
                const currentProgress = circuit.data.waitingQueue.completedContributions
                const currentZkeyIndex = formatZkeyIndex(currentProgress)
                const nextZkeyIndex = formatZkeyIndex(currentProgress + 1)

                // after contribution
                const finalZkeyLocalPath = `./${circuit.data.prefix}_final.zkey`
                const verificationKeyLocalPath = `./${circuit.data.prefix}_vkey.json`
                const verificationKeyStoragePath = `${collections.circuits}/${circuit.data.prefix}/${circuit.data.prefix}_vkey.json`
        
                // Export vkey.
                const verificationKeyJSONData = await zKey.exportVerificationKey(finalZkeyLocalPath)

                writeLocalJsonFile(verificationKeyLocalPath, verificationKeyJSONData)

                // upload verification key
                            // Upload vkey to storage.
                const bucketName = getBucketName(ceremony.data.prefix, process.env.CONFIG_CEREMONY_BUCKET_POSTFIX!)

                await multiPartUpload(
                    userFunctions,
                    bucketName,
                    verificationKeyStoragePath,
                    verificationKeyLocalPath,
                    process.env.CONFIG_STREAM_CHUNK_SIZE_IN_MB || "50",
                    Number(process.env.CONFIG_PRESIGNED_URL_EXPIRATION_IN_SECONDS) || 7200
                )

                // finalize last contribution
                await finalizeLastContribution(userFunctions, ceremony.id, circuit.id, bucketName)
            }

            // finalize 
            await finalizeCeremony(userFunctions, ceremony.id)

            // confirm that the ceremony status is finalized 

            // query again firestore

            // expect(ceremony) is finalized

        })
    })

})
