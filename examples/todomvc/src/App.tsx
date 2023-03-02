import { useState, createContext, useContext, useEffect } from 'react'
import { Fireproof } from '../../../'
import useFireproof from './hooks/useFireproof'
import { useKeyring } from '@w3ui/react-keyring'
import reactLogo from './assets/react.svg'
import './App.css'
import {
  Route, Link, Outlet, RouterProvider, createBrowserRouter, useRevalidator,
  createRoutesFromElements, useNavigate, useParams, useLoaderData
} from "react-router-dom";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router-dom";
import AppHeader from './components/AppHeader/index.jsx';
import Footer from './components/Footer'
import Spinner from './components/Spinner'
import InputArea from './components/InputArea'
import TodoItem from './components/TodoItem'
import { W3APIProvider } from './components/W3API'
import { Authenticator } from './components/Authenticator'

export const FireproofCtx = createContext<Fireproof>(null)

function Login() {
  // const { user, doLogin, doLogout } = useContext(UserCtx)
  const user = null
  const doLogin = () => { }
  const doLogout = () => { }

  const style = { cursor: 'pointer' }
  const actionForm = (
    <span>
      <button style={style} onClick={doLogin}>
        Login or Sign Up to sync your todos
      </button>
    </span>
  )
  return (
    <div className='Login'>
      {user
        ? (
          <button style={style} onClick={doLogout}>
            Logout
          </button>
        )
        : (
          actionForm
        )}
    </div>
  )
}



// w3ui keyring

function SpaceRegistrar(): JSX.Element {
  const [, { registerSpace }] = useKeyring()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  function resetForm(): void {
    setEmail('')
  }
  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    setSubmitted(true)
    try {
      await registerSpace(email)
    } catch (err) {
      console.log(err)
      throw new Error('failed to register', { cause: err })
    } finally {
      resetForm()
      setSubmitted(false)
    }
  }
  return (
    <div className='flex flex-col items-center space-y-24 pt-12'>
      <div className='flex flex-col items-center space-y-2'>
        <h3 className='text-lg'>Verify your email address!</h3>
        <p>
          Click the link in the email we sent to start uploading to this space.
        </p>
      </div>
      <div className='flex flex-col items-center space-y-4'>
        <h5>Need a new verification email?</h5>
        <form
          className='flex flex-col items-center space-y-2'
          onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
            void onSubmit(e)
          }}
        >
          <input
            className='text-black px-2 py-1 rounded'
            type='email'
            placeholder='Email'
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
            }}
          />
          <input
            type='submit'
            className='w3ui-button'
            value='Re-send Verification Email'
            disabled={email === ''}
          />
        </form>
        {submitted && (
          <p>
            Verification re-sent, please check your email for a verification
            email.
          </p>
        )}
      </div>
    </div>
  )
}







function AllLists() {
  const { addList, database, addSubscriber } = useContext(FireproofCtx)
  const navigate = useNavigate()
  let lists = useLoaderData() as ListDoc[];
  const revalidator = useRevalidator()
  addSubscriber('AllLists', () => {
    revalidator.revalidate();
  })


  const onSubmit = async (title: string) => {
    const { id } = await addList(title)
  }
  return (
    <div>
      <div className='listNav'>
        <button onClick={async () => {
          const allDocs = await database.changesSince()
          console.log('allDocs', allDocs.rows)
        }}>Choose a list.</button>
        <label></label>
      </div>
      <section className='main'>
        <ul className='todo-list'>
          {lists.map(({ title, _id }) => {
            return (
              <li key={_id}>
                <label>
                  <Link to={`/list/${_id}`}>{title}</Link>
                </label>
              </li>
            )
          })}
        </ul>
      </section>
      <InputArea
        onSubmit={onSubmit}
        placeholder='Create a new list or choose from above.'
      />
      <TimeTravel database={database} />

    </div>
  )
}

interface Doc {
  _id: string
}

interface TodoDoc extends Doc {
  completed: boolean
  title: string
  listId: string
  type: "todo"
}
interface ListDoc extends Doc {
  title: string
  type: "list"
}


interface AppState {
  list: ListDoc,
  todos: TodoDoc[],
  err: Error | null
}

function List() {
  const {
    addTodo,
    toggle,
    destroy,
    clearCompleted,
    updateTitle, database, addSubscriber
  } = useContext(FireproofCtx)
  let { list, todos } = useLoaderData() as ListLoaderData;

  const revalidator = useRevalidator()
  addSubscriber('one List', () => {
    revalidator.revalidate();
  })

  const pathFlag = 'all'
  const uri = window.location.pathname
  const filteredTodos = {
    all: todos,
    active: todos.filter((todo) => !todo.completed),
    completed: todos.filter((todo) => todo.completed)
  }
  const shownTodos = filteredTodos[pathFlag]


  const [editing, setEditing] = useState("")
  const navigate = useNavigate()
  const edit = (todo: TodoDoc) => () => setEditing(todo._id)
  const onClearCompleted = async () => await clearCompleted(list._id)

  const [{ space }] = useKeyring()
  const registered = Boolean(space?.registered())


  return (
    <div>
      <div className='listNav'>
        <button onClick={() => navigate('/')}>Back to all lists</button>
        <label>{list.title}</label>
      </div>
      <ul className='todo-list'>
        {shownTodos.map((todo) => {
          const handle = (fn: (arg0: TodoDoc, arg1: string) => any) => (val: string) => fn(todo, val)
          return (
            <TodoItem
              key={todo._id}
              todo={todo}
              onToggle={handle(toggle)}
              onDestroy={handle(destroy)}
              onSave={handle(updateTitle)}
              onEdit={edit(todo)}
              editing={editing === todo._id}
              onCancel={console.log}
            />
          )
        })}
      </ul>
      <InputArea
        onSubmit={async (title: string) =>
          await addTodo(list._id, title)
        }
        placeholder='Add a new item to your list.'

      />

      <Footer
        count={shownTodos.length}
        completedCount={
          filteredTodos['completed'].length
        }
        onClearCompleted={onClearCompleted}
        nowShowing={pathFlag}
        uri={uri && uri.split('/').slice(0, 3).join('/')}
      />
      <TimeTravel database={database} />
      {!registered && <SpaceRegistrar />}
    </div>
  )
}


const shortLink = l => `${String(l).slice(0, 4)}..${String(l).slice(-4)}`
const clockLog = new Set<string>()

const TimeTravel = ({ database }) => {
  database.clock && database.clock.length && clockLog.add(database.clock.toString())
  const diplayClocklog = Array.from(clockLog).reverse()
  return (<div className='timeTravel'>
    <h2>Time Travel</h2>
    {/* <p>Copy and paste a <b>Fireproof clock value</b> to your friend to share application state, seperate them with commas to merge state.</p> */}
    {/* <InputArea
      onSubmit={
        async (tex: string) => {
          await database.setClock(tex.split(','))
        }
      }
      placeholder='Copy a CID from below to rollback in time.'
      autoFocus={false}
    /> */}
    <p>Click a <b>Fireproof clock value</b> below to rollback in time.</p>
    <p>Clock log (newest first): </p>
    <ol type={"1"}>
      {diplayClocklog.map((entry) => (
        <li key={entry}>
          <button onClick={async () => {
            await database.setClock([entry])
          }} >{shortLink(entry)}</button>
        </li>
      ))}
    </ol>
  </div>)
}

const NotFound = () => {
  console.log('rendering NotFound')
  return (
    <div>
      <h2>Not found</h2>
      <p>Sorry, nothing here.</p>
      <Link to='/'>Go back to the main page.</Link>
    </div>
  )
}

interface ListLoaderData {
  list: ListDoc
  todos: TodoDoc[]
}


function Layout() {
  return (
    <>
      <AppHeader />
      <div>
        <header className='header'>
          {/* <Login /> */}
          <Outlet />
        </header>
      </div>
    </>
  );
}

const pageBase = document.location.pathname.split('/list')[0] || ''

function App() {
  const fireproof = useFireproof()
  const { fetchListWithTodos, fetchAllLists } = fireproof

  async function listLoader({ params: { listId } }: LoaderFunctionArgs): Promise<ListLoaderData> {
    return await fetchListWithTodos(listId)
  }

  async function allListLoader({ params }: LoaderFunctionArgs): Promise<ListDoc[]> {
    return await fetchAllLists()
  }

  let router = createBrowserRouter(
    createRoutesFromElements(
      <Route element={<Layout />} >
        <Route path='/' loader={allListLoader} element={<AllLists />} />
        <Route path='list'>
          <Route path=':listId' loader={listLoader} element={<List />} >
            <Route path='active' element={<List />} />
            <Route path='completed' element={<List />} />
          </Route>
        </Route>
      </Route>
    ),{basename: pageBase});
  return (
    <FireproofCtx.Provider value={fireproof}>
      <W3APIProvider uploadsListPageSize={20}>
        <Authenticator className='h-full'>
          <RouterProvider router={router} fallbackElement={<NotFound />} />
        </Authenticator>
      </W3APIProvider>
    </FireproofCtx.Provider>
  )
}

export default App
