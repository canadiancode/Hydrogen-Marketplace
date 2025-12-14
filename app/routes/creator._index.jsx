import {redirect} from 'react-router';

export async function loader({context}) {
  // Check if creator is authenticated
  // const isAuthenticated = await checkCreatorAuth(context);
  
  // if (!isAuthenticated) {
  //   return redirect('/creator/login');
  // }
  
  return redirect('/creator/dashboard');
}