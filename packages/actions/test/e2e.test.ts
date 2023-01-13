import dotenv from 'dotenv'
import chai from "chai"
import chaiAsPromised from "chai-as-promised"
import {
    checkParticipantForCeremony,
    getCurrentFirebaseAuthUser,
    getDocumentById,
    getNewOAuthTokenUsingGithubDeviceFlow,
    getNextCircuitForContribution,
    getOpenedCeremonies,
    signInToFirebaseWithGithubToken
} from '../src/index'
import { initializeApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"
import path from "path"
import { initializeAdminServices, sleep } from "./utils"
import { fakeCeremoniesData, fakeCircuitsData } from "./data/samples"
import { getFunctions } from "firebase/functions"
import { collections } from "src/helpers/constants"

jest.setTimeout(50000000)

// Config chai.
chai.use(chaiAsPromised)
dotenv.config({ path: path.join(__dirname, '../.env.test')})

const createCeremony = async () => {
    // Initialize admin and user services.
    const { adminFirestore, adminAuth } = initializeAdminServices()

    // Create the fake data on Firestore.
    await adminFirestore
    .collection(`ceremonies`)
    .doc(fakeCeremoniesData.fakeCeremonyOpenedFixed.uid)
    .set({
        ...fakeCeremoniesData.fakeCeremonyOpenedFixed.data
    })

    await adminFirestore
    .collection(`ceremonies/${fakeCeremoniesData.fakeCeremonyOpenedFixed.uid}/circuits`)
    .doc(fakeCircuitsData.fakeCircuitSmallNoContributors.uid)
    .set({
        ...fakeCircuitsData.fakeCircuitSmallNoContributors.data
    })

}

const deleteCeremony = async () => {
    // Initialize admin and user services.
    const { adminFirestore, adminAuth } = initializeAdminServices()

    await adminFirestore
    .collection(`ceremonies/${fakeCeremoniesData.fakeCeremonyOpenedFixed.uid}/circuits`)
    .doc(fakeCircuitsData.fakeCircuitSmallNoContributors.uid)
    .delete()

    // TODO: use a listener.
    // nb. workaround (wait until circuit has been deleted, then delete the ceremony).
    await sleep(1000)

    await adminFirestore.collection(`ceremonies`).doc(fakeCeremoniesData.fakeCeremonyOpenedFixed.uid).delete()

}

// mock adding some data to the collections

describe("E2E", () => {
    if (!process.env.GITHUB_CLIENT_ID) throw new Error("Not configured correctly")

    // create the app 
    const firebaseApp = initializeApp({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    })

    const firestoreDatabase = getFirestore(firebaseApp)
    const firebaseFunctions = getFunctions(firebaseApp)

    describe("Auth and Contribute", () => {
        beforeEach(async () => {
            // mock creating a ceremony
            await createCeremony()
        })

        it('contributor authenticates and lists available ceremonies', async () => {
            // get the token 
            // this step requires to actually do the device flow 
            // // need to find a way to do that automatically
            const token = await getNewOAuthTokenUsingGithubDeviceFlow(
                String(process.env.GITHUB_CLIENT_ID)
            )
            // sign in with the token
            // await mockAuth()
            // console.log(process.env.GITHUB_ACCESS_TOKEN)
            await signInToFirebaseWithGithubToken(firebaseApp, process.env.GITHUB_ACCESS_TOKEN!)
            
            // list all ceremonies
            const ceremonies = await getOpenedCeremonies(firestoreDatabase)
            // check that we have at least 1
            expect(ceremonies.length).toBeGreaterThan(0)

        }) 

        it('contibutor authenticates and lists all available ceremonies, then submits entropy for one of them', async () => {
            // auth 
            // @todo 
            // Get current authenticated user.
            const user = getCurrentFirebaseAuthUser(firebaseApp)
            expect(user).toBeDefined
            
            const ceremonies = await getOpenedCeremonies(firestoreDatabase)
            expect(ceremonies.length).toBeGreaterThan(0)

            const ceremony = ceremonies.at(0)
            expect(ceremony?.id).toBeDefined
            // call can participate
            const canParticipate = await checkParticipantForCeremony(firebaseFunctions, ceremony?.id!)
            expect(canParticipate).toBeTruthy
            
            const participantDoc = await getDocumentById(
                firestoreDatabase,
                `${collections.ceremonies}/${ceremony?.id}/${collections.participants}`,
                user.uid
            )

            // Get updated data from snap.
            const participantData = participantDoc.data()
            expect(participantData).toBeDefined

            // get the next circuit available for contribution
            const circuit = getNextCircuitForContribution(ceremonies, 1)
        })

        it('tries to participate in a ceremony but times out, the user is unable to contribute again to the same one', async () => {
            
        })

        it('the contributor is locked out but they manage to contribute to another ceremony instead', async () => {})
        it('generates a transcript for the contribution. The queue is updated accordingly', async () => {})
        it('contributes and checks the gist with the contribution summary', async () => {})
        
        afterEach(async () => {
            // clean up 
            await deleteCeremony()
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
