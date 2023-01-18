import dotenv from 'dotenv'
import chai, { assert } from "chai"
import chaiAsPromised from "chai-as-promised"
import {
    checkParticipantForCeremony,
    createS3Bucket,
    getBucketName,
    getCeremonyCircuits,
    getCurrentFirebaseAuthUser,
    getDocumentById,
    getNewOAuthTokenUsingGithubDeviceFlow,
    getNextCircuitForContribution,
    getOpenedCeremonies,
    multiPartUpload,
    signInToFirebaseWithGithubToken
} from '../src/index'
import path from "path"
import { deleteAdminApp, initializeAdminServices, initializeUserServices, sleep } from "./utils"
import { collections, names, potFilenameTemplate } from "../src/helpers/constants"
import { createCeremony, deleteCeremony } from './utils'
import { fakeCircuitsData } from './data/samples'
import { randomBytes} from "crypto"

jest.setTimeout(50000000)

const convertToDoubleDigits = (amount: number): string => (amount < 10 ? `0${amount}` : amount.toString())

// Config chai.
chai.use(chaiAsPromised)
dotenv.config({ path: path.join(__dirname, '../.env.test')})

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

            // get the next circuit available for contribution
            const circuit = getNextCircuitForContribution(circuits, 1)
            expect(circuit).toBeDefined

            // entropy
            // const entropyOrBeacon = new Uint8Array(256).map(() => Math.random() * 256).toString()
        })

        it('tries to participate in a ceremony but times out, the user is unable to contribute again to the same one', async () => {
            
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
            /**
             * Steps
             * Auth
             * Read R1CS
             * Get ceremony details
             * Get circuit details
             * Extract circuit metadata
             * Create S3 bucket
             * Check if zkeys are already generated
             * Upload data to S3
             * Call SetupCeremony Cloud function
             */
           
            // 1. Auth
            const token = await getNewOAuthTokenUsingGithubDeviceFlow(
                String(process.env.GITHUB_CLIENT_ID)
            )

            await signInToFirebaseWithGithubToken(userApp, token)

            // 2. Mock data extraction
            const circuit = fakeCircuitsData.fakeCircuitSmallNoContributors
            let stringifyNeededPowers = convertToDoubleDigits(circuit.data.metadata.pot)
            let smallestPotForCircuit = `${potFilenameTemplate}${stringifyNeededPowers}.ptau`            
            const potStoragePath = `${names.pot}`
            let potStorageFilePath = `${potStoragePath}/${smallestPotForCircuit}`

            const zkeyStoragePath = `${collections.circuits}/${circuit.data.prefix}/${collections.contributions}`
            const firstZkeyFileName = `${circuit.data.prefix}_00000.zkey`
            const zkeyStorageFilePath = `${zkeyStoragePath}/${firstZkeyFileName}`

            const r1csFileName = `${circuit.data.name}.r1cs`
            const r1csStoragePath = `${collections.circuits}/${circuit.data.prefix}`
            const r1csStorageFilePath = `${r1csStoragePath}/${r1csFileName}`

            // 3. create s3 bucket
            const ceremonyPrefix = randomBytes(20).toString('hex')
            const bucketName = getBucketName(ceremonyPrefix, process.env.CONFIG_CEREMONY_BUCKET_POSTFIX!)
            const success = await createS3Bucket(userFunctions, bucketName)
            expect(success).toBeTruthy

            await sleep(1000)

            // 4. Upload
            assert.isRejected(multiPartUpload(
                userFunctions,
                bucketName,
                zkeyStorageFilePath,
                zkeyStoragePath,
                process.env.CONFIG_STREAM_CHUNK_SIZE_IN_MB || "50",
                Number(process.env.CONFIG_PRESIGNED_URL_EXPIRATION_IN_SECONDS) || 7200
            ))
        })
        it('successfully setups a new ceremony', async () => {

        })
    })

    describe('Finalize', () => {
        it('successfully finalizes a ceremony', async () => {})
    })

})
