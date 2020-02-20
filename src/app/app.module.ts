import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import {
	IgxAvatarModule,
	IgxNavbarModule,
	IgxLayoutModule,
	IgxRippleModule,
	IgxIconModule,
	IgxInputGroupModule,
	IgxToggleModule,
	IgxBadgeModule,
	IgxButtonModule,
	IgxCardModule,
	IgxDividerModule
} from 'igniteui-angular';

import { AppComponent } from './app.component';
import { HomeComponent } from './home/home.component';
import { AppRoutingModule } from './app-routing.module';

import { JwtInterceptor, ErrorInterceptor } from './helpers';
import { TopBarComponent, NavigationBarComponent, UserBarComponent, LoginComponent, RegisterComponent } from './components';


@NgModule({
	imports: [
		BrowserAnimationsModule,
		BrowserModule,
		ReactiveFormsModule,
		HttpClientModule,
		AppRoutingModule,
		IgxAvatarModule,
		IgxBadgeModule,
		IgxButtonModule,
		IgxCardModule,
		IgxNavbarModule,
		IgxLayoutModule,
		IgxIconModule,
		IgxRippleModule,
		IgxInputGroupModule,
		IgxToggleModule,
		IgxDividerModule,
	],
	declarations: [
		AppComponent,
		HomeComponent,
		UserBarComponent,
		LoginComponent,
		RegisterComponent,
		TopBarComponent,
		NavigationBarComponent,
	],
	providers: [
		{ provide: HTTP_INTERCEPTORS, useClass: JwtInterceptor, multi: true },
		{ provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true }
	],
	bootstrap: [AppComponent]
})
export class AppModule { }
