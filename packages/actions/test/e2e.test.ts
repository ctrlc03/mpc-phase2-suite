import dotenv from 'dotenv'
import chai from "chai"
import chaiAsPromised from "chai-as-promised"
import {
    checkParticipantForCeremony,
    getCeremonyCircuits,
    getCurrentFirebaseAuthUser,
    getDocumentById,
    getNewOAuthTokenUsingGithubDeviceFlow,
    getNextCircuitForContribution,
    getOpenedCeremonies,
    signInToFirebaseWithGithubToken
} from '../src/index'
import path from "path"
import { deleteAdminApp, initializeAdminServices, initializeUserServices } from "./utils"
import { collections } from "../src/helpers/constants"
import { createCeremony, deleteCeremony } from './utils'

jest.setTimeout(50000000)

// Config chai.
chai.use(chaiAsPromised)
dotenv.config({ path: path.join(__dirname, '../.env.test')})

describe("E2E", () => {
    if (!process.env.GITHUB_CLIENT_ID) throw new Error("Not configured correctly")

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


    describe('Setup', () => {
        it('fails to setup a new ceremony due to some error with the circuit files', async () => {

        })
        it('successfully setups a new ceremony', async () => {

        })
    })

    describe('Finalize', () => {
        it('successfully finalizes a ceremony', async () => {})
    })

})
