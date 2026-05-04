mod commands;
mod core;

use std::sync::Arc;

use tauri::Manager;

use crate::core::ai_guard::AiGuard;
use crate::core::collections::CollectionStore;
use crate::core::settings::SettingsStore;
use crate::core::size_index::SizeIndex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let size_index = Arc::new(SizeIndex::new());

    tauri::Builder::default()
        .manage(size_index)
        .setup(|app| {
            let handle = app.handle();
            let collections = CollectionStore::load(&handle);
            let settings = Arc::new(SettingsStore::load(&handle));
            let ai_guard = Arc::new(AiGuard::new());
            app.manage(collections);
            app.manage(settings);
            app.manage(ai_guard);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::stat,
            commands::parent_of,
            commands::home_path,
            commands::default_shortcuts,
            commands::list_volumes,
            commands::create_directory,
            commands::create_file,
            commands::write_text_file,
            commands::rename,
            commands::move_to_trash,
            commands::delete_forever,
            commands::copy_path,
            commands::move_path,
            commands::reveal_in_native,
                        commands::open_with_default,
            commands::read_text_file,
            commands::dir_size_cached,
            commands::request_dir_size,
            commands::invalidate_dir_size,
            commands::list_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::list_collection_entries,
            commands::list_packs,
            commands::read_pack_asset,
            commands::read_pack_text,
            commands::install_pack_from_folder,
            commands::uninstall_pack,
            commands::pack_dir,
            commands::settings_get_all,
            commands::settings_get,
            commands::settings_set,
            commands::list_archive,
            commands::extract_archive,
            commands::default_extract_dir,
            commands::create_zip,
            commands::ai_set_readonly,
            commands::ai_get_readonly,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
