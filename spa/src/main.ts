/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import "@fontsource-variable/archivo";
import "@fontsource-variable/golos-text";
import "./style.css";

import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { useUiStore } from "./stores/ui";

const app = createApp(App);
app.use(createPinia());

useUiStore().initTheme();

app.mount("#app");
