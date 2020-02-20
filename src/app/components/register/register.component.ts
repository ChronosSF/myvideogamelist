import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { first } from 'rxjs/operators';

import { AuthenticationService } from '../../services';

@Component({
	templateUrl: 'register.component.html'
})
export class RegisterComponent implements OnInit {
	registerForm: FormGroup;
	loading = false;
	submitted = false;
	returnUrl: string;
	error = '';

	constructor(
		private formBuilder: FormBuilder,
		private route: ActivatedRoute,
		private router: Router,
		private authenticationService: AuthenticationService
	) {
		// redirect to home if already logged in
		if (this.authenticationService.currentUserValue) {
			this.router.navigate(['/']);
		}
	}

	ngOnInit() {
		this.registerForm = this.formBuilder.group({
			email: ['', Validators.required, Validators.email],
			username: ['', Validators.required],
			password: ['', Validators.required],
			confirmPassword: ['', Validators.required]
		});

		// get return url from route parameters or default to '/'
		this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';
	}

	// convenience getter for easy access to form fields
	get f() { return this.registerForm.controls; }

	onSubmit() {
		this.submitted = true;

		// stop here if form is invalid
		if (this.registerForm.invalid) {
			return;
		}

		this.loading = true;
		this.authenticationService.register(this.f.email.value, this.f.username.value, this.f.password.value)
			.pipe(first())
			.subscribe(
				data => {
					this.router.navigate([this.returnUrl]);
				},
				error => {
					this.error = error;
					this.loading = false;
				});
	}
}
