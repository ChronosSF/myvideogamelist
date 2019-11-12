import { Routes, RouterModule } from '@angular/router';

import { LoginComponent } from './login';
import { AuthGuard } from './helpers';
import { HomeComponent } from './home/home.component';
import { RegisterComponent } from './register';

const routes: Routes = [
	{ path: '', component: HomeComponent/*, canActivate: [AuthGuard] */ },
	{ path: 'login', component: LoginComponent },
	{ path: 'register', component: RegisterComponent },
	{ path: 'gamelist', component: LoginComponent, canActivate: [AuthGuard] },

	// otherwise redirect to home
	{ path: '**', redirectTo: '' }
];

export const AppRoutingModule = RouterModule.forRoot(routes);